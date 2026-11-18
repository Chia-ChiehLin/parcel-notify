import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { NotificationKind, NotifyStatus } from '@/db/schema';
import { emailGateway, lineGateway } from '@/channels/gateway';
import { arrivalEmail, arrivalFlex, pickupText, type ParcelSummary } from '@/channels/messages';
import { resolveCommunityChannel, type ResolvedChannel } from './line-channels';
import { parseSettings, type CommunitySettings } from './settings';
import { residentUrl } from './tokens';
import { bumpUsage } from './usage';

type Community = typeof schema.communities.$inferSelect;
type Resident = typeof schema.residents.$inferSelect;

export type NotifySummary = {
  unitId: string;
  status: NotifyStatus;
  line: number;
  email: number;
  failed: number;
};

function errMessage(e: unknown) {
  if (e && typeof e === 'object' && 'body' in e) {
    const body = (e as { body?: unknown }).body;
    if (typeof body === 'string') return body.slice(0, 300);
  }
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}

/** 依社區設定挑出要通知的住戶 */
export function pickRecipients(members: Resident[], settings: Pick<CommunitySettings, 'notifyAllMembers'>): Resident[] {
  const active = members.filter((m) => m.status === 'active');
  if (settings.notifyAllMembers) return active;
  const primary = active.find((m) => m.isPrimary) ?? active[0];
  // 主要聯絡人之外，自己開啟 Email 通知的成員也會收到（Email 不額外花 LINE 費用）
  const extraEmail = active.filter((m) => m !== primary && m.notifyEmail && m.email);
  return primary ? [primary, ...extraEmail] : extraEmail;
}

function canUseLine(r: Resident, resolved: ResolvedChannel | null) {
  return !!resolved && !!r.lineUserId && r.notifyLine && r.lineFollowing && r.lineChannelId === resolved.channel.id;
}

async function record(
  community: Community,
  unitId: string,
  resident: Resident,
  channel: 'line' | 'email',
  kind: NotificationKind,
  parcelIds: string[],
  error?: string,
) {
  await db()
    .insert(schema.notifications)
    .values({
      communityId: community.id,
      unitId,
      residentId: resident.id,
      channel,
      kind,
      parcelIds,
      status: error ? 'failed' : 'sent',
      error: error ?? null,
    });
  if (!error) await bumpUsage(community.id, channel === 'line' ? 'linePush' : 'email');
}

/**
 * 發送到件（或逾期提醒）通知。同一戶的多件包裹合併成一則訊息。
 */
export async function notifyUnitParcels(
  community: Community,
  unitId: string,
  parcelIds: string[],
  kind: 'arrival' | 'reminder' = 'arrival',
): Promise<NotifySummary> {
  const summary: NotifySummary = { unitId, status: 'no_recipient', line: 0, email: 0, failed: 0 };
  if (!parcelIds.length) return summary;
  const settings = parseSettings(community.settings);

  const finish = async (status: NotifyStatus) => {
    summary.status = status;
    if (kind === 'arrival') {
      await db()
        .update(schema.parcels)
        .set({ notifyStatus: status, notifiedAt: status === 'sent' || status === 'partial' ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(schema.parcels.communityId, community.id), inArray(schema.parcels.id, parcelIds)));
    }
    return summary;
  };

  if (community.status === 'suspended' || community.status === 'cancelled') return finish('skipped');

  const [unit] = await db().select().from(schema.units).where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, community.id)));
  if (!unit) return finish('failed');
  const parcels = await db()
    .select()
    .from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, community.id), inArray(schema.parcels.id, parcelIds), eq(schema.parcels.status, 'waiting')))
    .orderBy(asc(schema.parcels.receivedAt));
  if (!parcels.length) return finish('skipped');

  const members = await db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(asc(schema.residents.boundAt));
  const recipients = pickRecipients(members, settings);
  if (!recipients.length) return finish('no_recipient');

  const resolved = await resolveCommunityChannel(community);
  const summaries: ParcelSummary[] = parcels.map((p) => ({
    carrier: p.carrier,
    categories: p.categories,
    storageLocation: p.storageLocation,
    quantity: p.quantity,
    pickupCode: p.pickupCode,
    receivedAt: p.receivedAt,
  }));
  const ids = parcels.map((p) => p.id);
  let attempted = 0;

  for (const r of recipients) {
    const ctx = {
      kind,
      lang: r.language,
      communityName: community.name,
      unitLabel: unit.label,
      parcels: summaries,
      link: residentUrl(r),
      deskPhone: settings.deskPhone,
      deskHours: settings.deskHours,
    };
    let delivered = false;
    if (canUseLine(r, resolved)) {
      attempted++;
      try {
        await lineGateway().push(resolved!.creds, r.lineUserId!, [arrivalFlex(ctx)]);
        await record(community, unitId, r, 'line', kind, ids);
        summary.line++;
        delivered = true;
      } catch (e) {
        await record(community, unitId, r, 'line', kind, ids, errMessage(e));
        summary.failed++;
      }
    }
    const wantsEmail = !!r.email && (r.notifyEmail || (!delivered && settings.emailFallback));
    if (!delivered && wantsEmail && emailGateway().isConfigured()) {
      attempted++;
      try {
        await emailGateway().send({ to: r.email!, ...arrivalEmail(ctx) });
        await record(community, unitId, r, 'email', kind, ids);
        summary.email++;
        delivered = true;
      } catch (e) {
        await record(community, unitId, r, 'email', kind, ids, errMessage(e));
        summary.failed++;
      }
    } else if (delivered && r.notifyEmail && r.email && emailGateway().isConfigured()) {
      // 住戶同時開啟 LINE 和 Email
      try {
        await emailGateway().send({ to: r.email, ...arrivalEmail(ctx) });
        await record(community, unitId, r, 'email', kind, ids);
        summary.email++;
      } catch (e) {
        await record(community, unitId, r, 'email', kind, ids, errMessage(e));
      }
    }
  }

  const ok = summary.line + summary.email;
  if (attempted === 0) return finish('no_recipient');
  return finish(ok === 0 ? 'failed' : summary.failed > 0 ? 'partial' : 'sent');
}

/** 領取完成通知（社區設定開啟時才發） */
export async function notifyPickup(community: Community, unitId: string, parcelIds: string[], pickedBy?: string | null) {
  const settings = parseSettings(community.settings);
  if (!settings.notifyOnPickup || !parcelIds.length) return;
  if (community.status === 'suspended' || community.status === 'cancelled') return;
  const [unit] = await db().select().from(schema.units).where(eq(schema.units.id, unitId));
  if (!unit) return;
  const members = await db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(asc(schema.residents.boundAt));
  const recipients = pickRecipients(members, settings);
  const resolved = await resolveCommunityChannel(community);
  const rows = await db().select({ quantity: schema.parcels.quantity }).from(schema.parcels).where(inArray(schema.parcels.id, parcelIds));
  const n = rows.reduce((s, r) => s + r.quantity, 0);
  for (const r of recipients) {
    if (!canUseLine(r, resolved)) continue;
    try {
      await lineGateway().push(resolved!.creds, r.lineUserId!, [{ type: 'text', text: pickupText(r.language, unit.label, n, new Date(), pickedBy) }]);
      await record(community, unitId, r, 'line', 'pickup', parcelIds);
    } catch (e) {
      await record(community, unitId, r, 'line', 'pickup', parcelIds, errMessage(e));
    }
  }
}
