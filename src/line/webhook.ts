import type { webhook } from '@line/bot-sdk';
import { lineGateway, type LineCreds, type LineMessage } from '@/channels/gateway';
import { linkButtons, pendingListMessage, type ParcelSummary } from '@/channels/messages';
import { COMMANDS, dict, fill } from '@/i18n/resident';
import { brandName } from '@/lib/env';
import type { ChannelRow } from '@/domain/line-channels';
import { waitingForUnit } from '@/domain/parcels';
import { bindByCode, listBindingsForLineUser, normalizeBindCode, setLineFollowing } from '@/domain/residents';
import { residentUrl } from '@/domain/tokens';

type Event = webhook.Event;

function matches(text: string, list: string[]) {
  const t = text.trim().toLowerCase();
  return list.some((c) => t === c.toLowerCase());
}

async function reply(creds: LineCreds, token: string | undefined, messages: LineMessage[]) {
  if (!token || !messages.length) return;
  await lineGateway().reply(creds, token, messages.slice(0, 5));
}

/** 住戶的語言：已綁定的用住戶設定，還沒綁定的預設繁體中文 */
function langOf(bindings: { resident: { language: string } }[]) {
  return bindings[0]?.resident.language ?? 'zh-TW';
}

export async function handleLineEvents(channel: ChannelRow, creds: LineCreds, events: Event[]) {
  const results = await Promise.allSettled(events.map((e) => handleEvent(channel, creds, e)));
  for (const r of results) {
    if (r.status === 'rejected') console.error('[line] event failed', r.reason);
  }
}

async function handleEvent(channel: ChannelRow, creds: LineCreds, event: Event) {
  const source = event.source;
  if (!source || source.type !== 'user' || !source.userId) return; // 不處理群組
  const userId = source.userId;
  const replyToken = 'replyToken' in event ? (event.replyToken as string | undefined) : undefined;

  if (event.type === 'unfollow') {
    await setLineFollowing(channel.id, userId, false);
    return;
  }

  const bindings = await listBindingsForLineUser(channel.id, userId);
  const lang = langOf(bindings);
  const d = dict(lang);

  if (event.type === 'follow') {
    await setLineFollowing(channel.id, userId, true);
    if (bindings.length) {
      await reply(creds, replyToken, [
        linkButtons(lang, fill(d.bindAlready, { community: bindings[0].community.name, unit: bindings[0].unit.label }), d.myParcels, residentUrl(bindings[0].resident)),
      ]);
    } else {
      await reply(creds, replyToken, [{ type: 'text', text: fill(d.welcome, { brand: brandName() }) }]);
    }
    return;
  }

  let text: string | null = null;
  if (event.type === 'message' && event.message.type === 'text') text = event.message.text;
  if (event.type === 'postback') text = new URLSearchParams(event.postback.data).get('cmd');
  if (text === null) return;

  // 綁定碼
  const code = normalizeBindCode(text);
  if (code) {
    const profile = await lineGateway().getProfile(creds, userId);
    const result = await bindByCode({ channel, lineUserId: userId, code, displayName: profile?.displayName });
    if (result.status === 'bound' || result.status === 'already') {
      const msg =
        result.status === 'bound'
          ? fill(d.bindOk, { community: result.communityName, unit: result.unitLabel })
          : fill(d.bindAlready, { community: result.communityName, unit: result.unitLabel });
      await reply(creds, replyToken, [linkButtons(lang, msg, d.myParcels, residentUrl(result.resident))]);
    } else {
      const msg = result.status === 'locked' ? d.bindLocked : result.status === 'wrong_channel' ? d.bindWrongChannel : d.bindBadCode;
      await reply(creds, replyToken, [{ type: 'text', text: msg }]);
    }
    return;
  }

  if (!bindings.length) {
    await reply(creds, replyToken, [{ type: 'text', text: matches(text, COMMANDS.help) ? fill(d.welcome, { brand: brandName() }) : d.notBound }]);
    return;
  }

  if (matches(text, COMMANDS.parcels)) {
    const groups = [];
    for (const b of bindings) {
      const parcels = await waitingForUnit(b.community.id, b.unit.id);
      groups.push({
        communityName: b.community.name,
        unitLabel: b.unit.label,
        link: residentUrl(b.resident),
        parcels: parcels.map(
          (p): ParcelSummary => ({
            carrier: p.carrier,
            categories: p.categories,
            storageLocation: p.storageLocation,
            quantity: p.quantity,
            pickupCode: p.pickupCode,
            receivedAt: p.receivedAt,
          }),
        ),
      });
    }
    await reply(creds, replyToken, pendingListMessage(lang, groups));
    return;
  }

  if (matches(text, COMMANDS.pickup)) {
    await reply(
      creds,
      replyToken,
      bindings.slice(0, 5).map((b) => linkButtons(lang, `${b.community.name} ${b.unit.label}\n${d.showQrHint}`, d.viewPickupQr, residentUrl(b.resident))),
    );
    return;
  }

  if (matches(text, COMMANDS.settings)) {
    await reply(
      creds,
      replyToken,
      bindings.slice(0, 5).map((b) => linkButtons(lang, `${b.community.name} ${b.unit.label}`, d.settings, residentUrl(b.resident, '/settings'))),
    );
    return;
  }

  // 其他訊息：回覆使用說明（回覆不計費）
  await reply(creds, replyToken, [{ type: 'text', text: d.help }]);
}
