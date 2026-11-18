import { and, asc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm';
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
  const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : null;
  return status && Number.isInteger(status) && status >= 100 && status < 600
    ? `通知服務回應 HTTP ${status}`
    : '通知服務未確認送達，請查看服務狀態與額度';
}

/** 依社區設定挑出要通知的住戶 */
function lineRecipients(members: Resident[], settings: Pick<CommunitySettings, 'notifyAllMembers'>): Resident[] {
  const active = members.filter((m) => m.status === 'active');
  if (settings.notifyAllMembers) return active;
  const primary = active.find((m) => m.isPrimary) ?? active[0];
  return primary ? [primary] : [];
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
  await db().transaction(async (tx) => {
    await tx.insert(schema.notifications).values({
      communityId: community.id, unitId, residentId: resident.id, channel, kind, parcelIds,
      status: error ? 'failed' : 'sent', error: error ?? null,
    });
    if (!error) await bumpUsage(community.id, channel === 'line' ? 'linePush' : 'email', 1, new Date(), tx);
  });
}

/**
 * 發送到件（或逾期提醒）通知。同一戶的多件包裹合併成一則訊息。
 */
export async function notifyUnitParcels(
  community: Community,
  unitId: string,
  parcelIds: string[],
  kind: 'arrival' | 'reminder' = 'arrival',
  resend = false,
): Promise<NotifySummary> {
  const summary: NotifySummary = { unitId, status: 'no_recipient', line: 0, email: 0, failed: 0 };
  if (!parcelIds.length) return summary;
  const settings = parseSettings(community.settings);

  const [destination] = await db().select({ unit: schema.units, features: schema.plans.features })
    .from(schema.units).innerJoin(schema.communities, eq(schema.units.communityId, schema.communities.id))
    .innerJoin(schema.plans, eq(schema.communities.planId, schema.plans.id))
    .where(and(eq(schema.units.id, unitId), eq(schema.units.communityId, community.id)));
  if (!destination) return { ...summary, status: 'skipped' };
  const { unit, features } = destination;
  const parcelFilter = and(
    unit.occupancyStartedAt ? gte(schema.parcels.receivedAt, unit.occupancyStartedAt) : undefined,
    eq(schema.parcels.communityId, community.id),
    eq(schema.parcels.unitId, unitId),
    eq(schema.parcels.status, 'waiting'),
    inArray(schema.parcels.id, parcelIds),
  );
  const attemptAt = new Date();
  // 領取傳送權時一併標記，兩個櫃台同時送出也只會通知一次。未完成的傳送可由人員稍後重送。
  const parcels = kind === 'arrival'
    ? await db().update(schema.parcels)
        .set({ notifyStatus: 'sending', notifiedAt: attemptAt, updatedAt: attemptAt })
        .where(and(parcelFilter, resend
          ? or(ne(schema.parcels.notifyStatus, 'sending'), lt(schema.parcels.notifiedAt, new Date(attemptAt.getTime() - 15 * 60_000)))
          : eq(schema.parcels.notifyStatus, 'pending')))
        .returning()
    : await db().select().from(schema.parcels).where(parcelFilter).orderBy(asc(schema.parcels.receivedAt));
  if (!parcels.length) return { ...summary, status: 'skipped' };
  const ids = parcels.map((p) => p.id);
  const finish = async (status: NotifyStatus) => {
    summary.status = status;
    if (kind === 'arrival') {
      await db().update(schema.parcels)
        .set({ notifyStatus: status, notifiedAt: status === 'sent' || status === 'partial' ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(schema.parcels.communityId, community.id), eq(schema.parcels.unitId, unitId), inArray(schema.parcels.id, ids),
          eq(schema.parcels.notifyStatus, 'sending'), eq(schema.parcels.notifiedAt, attemptAt)));
    }
    return summary;
  };
  if (community.status === 'suspended' || community.status === 'cancelled') return finish('skipped');

  const members = await db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.communityId, community.id), eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(asc(schema.residents.boundAt));
  const pushRecipients = new Set(lineRecipients(members, settings));
  const recipients = members.filter((r) => pushRecipients.has(r) || (r.notifyEmail && r.verifiedEmail === r.email && r.emailVerifiedAt && !r.emailFallbackOnly && r.email));
  if (!recipients.length) return finish('no_recipient');

  let resolved: ResolvedChannel | null = null;
  let channelUnavailable = false;
  try {
    resolved = await resolveCommunityChannel(community);
  } catch {
    channelUnavailable = true;
  }
  const summaries: ParcelSummary[] = parcels.map((p) => ({
    carrier: p.carrier,
    categories: p.categories,
    storageLocation: p.storageLocation,
    quantity: p.quantity,
    pickupCode: p.pickupCode,
    receivedAt: p.receivedAt,
  }));
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
    if (pushRecipients.has(r) && channelUnavailable && r.lineUserId && r.notifyLine && r.lineFollowing) {
      attempted++;
      await record(community, unitId, r, 'line', kind, ids, '無法讀取 LINE 帳號設定');
      summary.failed++;
    } else if (pushRecipients.has(r) && canUseLine(r, resolved)) {
      attempted++;
      try {
        await lineGateway().push(resolved!.creds, r.lineUserId!, [arrivalFlex(ctx)]);
        delivered = true;
      } catch (e) {
        await record(community, unitId, r, 'line', kind, ids, errMessage(e));
        summary.failed++;
      }
    }
    if (delivered) {
      await record(community, unitId, r, 'line', kind, ids);
      summary.line++;
    }
    if (features.email && r.email && r.notifyEmail && r.emailVerifiedAt && r.verifiedEmail === r.email) {
      // Keep consent valid through dispatch. Changing the address or moving out waits for an in-flight send (bounded by the gateway timeout).
      const email = r.email;
      const result = await db().transaction(async (tx) => {
        const [recipient] = await tx.select().from(schema.residents)
          .where(and(eq(schema.residents.id, r.id), eq(schema.residents.communityId, community.id),
            eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active'), eq(schema.residents.notifyEmail, true),
            eq(schema.residents.email, email), eq(schema.residents.verifiedEmail, email),
            eq(schema.residents.tokenVersion, r.tokenVersion))).for('share');
        if (!recipient?.emailVerifiedAt || (recipient.emailFallbackOnly && (delivered || !settings.emailFallback || !pushRecipients.has(r)))) return null;
        if (!emailGateway().isConfigured()) return { error: '尚未設定寄件服務' };
        try {
          await emailGateway().send({ to: email, ...arrivalEmail(ctx) });
          return { error: undefined };
        } catch (e) {
          return { error: errMessage(e) };
        }
      });
      if (result) {
        attempted++;
        await record(community, unitId, r, 'email', kind, ids, result.error);
        if (result.error) summary.failed++;
        else summary.email++;
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
  const [unit] = await db().select().from(schema.units).where(and(eq(schema.units.communityId, community.id), eq(schema.units.id, unitId)));
  if (!unit) return;
  const members = await db()
    .select()
    .from(schema.residents)
    .where(and(eq(schema.residents.communityId, community.id), eq(schema.residents.unitId, unitId), eq(schema.residents.status, 'active')))
    .orderBy(asc(schema.residents.boundAt));
  const recipients = lineRecipients(members, settings);
  const resolved = await resolveCommunityChannel(community);
  const rows = await db().select({ id: schema.parcels.id, quantity: schema.parcels.quantity }).from(schema.parcels)
    .where(and(eq(schema.parcels.communityId, community.id), eq(schema.parcels.unitId, unitId), eq(schema.parcels.status, 'picked_up'),
      unit.occupancyStartedAt ? gte(schema.parcels.receivedAt, unit.occupancyStartedAt) : undefined, inArray(schema.parcels.id, parcelIds)));
  if (!rows.length) return;
  const ids = rows.map((row) => row.id);
  const n = rows.reduce((s, r) => s + r.quantity, 0);
  let failures = 0;
  for (const r of recipients) {
    if (!canUseLine(r, resolved)) continue;
    try {
      await lineGateway().push(resolved!.creds, r.lineUserId!, [{ type: 'text', text: pickupText(r.language, unit.label, n, new Date(), pickedBy) }]);
    } catch (e) {
      await record(community, unitId, r, 'line', 'pickup', ids, errMessage(e));
      failures++;
      continue;
    }
    await record(community, unitId, r, 'line', 'pickup', ids);
  }
  return { failures };
}
