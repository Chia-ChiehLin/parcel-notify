import { ImageResponse } from 'next/og';
import { eq } from 'drizzle-orm';
import type { messagingApi } from '@line/bot-sdk';
import { db, schema } from '@/db';
import { lineGateway } from '@/channels/gateway';
import { audit, type Actor } from '@/domain/audit';
import { credsOf, type ChannelRow } from '@/domain/line-channels';
import { DomainError } from '@/domain/types';

const WIDTH = 2500;
const HEIGHT = 843;

const ITEMS = [
  { label: '我的包裹', en: 'My parcels', icon: '📦', text: '我的包裹', bg: '#0f766e' },
  { label: '取件 QR', en: 'Pickup QR', icon: '🔳', text: '取件碼', bg: '#115e59' },
  { label: '通知設定', en: 'Settings', icon: '⚙️', text: '設定', bg: '#134e4a' },
  { label: '使用說明', en: 'Help', icon: '❓', text: '說明', bg: '#0f172a' },
];

/** 從 Google Fonts 取得只包含需要文字的思源黑體子集（避免中文變方塊） */
async function loadCjkFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700&text=${encodeURIComponent(text)}`, {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

async function renderImage(): Promise<Buffer> {
  const font = await loadCjkFont(ITEMS.map((i) => i.label).join(''));
  const res = new ImageResponse(
    (
      <div style={{ display: 'flex', width: WIDTH, height: HEIGHT }}>
        {ITEMS.map((item) => (
          <div
            key={item.text}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: WIDTH / 4,
              height: HEIGHT,
              background: item.bg,
              color: '#fff',
              borderRight: '4px solid rgba(255,255,255,0.15)',
            }}
          >
            <div style={{ fontSize: 220 }}>{item.icon}</div>
            <div style={{ fontSize: 110, fontWeight: 700, marginTop: 30, fontFamily: font ? 'NotoTC' : 'sans-serif' }}>{font ? item.label : item.en}</div>
          </div>
        ))}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      emoji: 'twemoji',
      fonts: font ? [{ name: 'NotoTC', data: font, weight: 700, style: 'normal' }] : undefined,
    },
  );
  return Buffer.from(await res.arrayBuffer());
}

function menuDefinition(): messagingApi.RichMenuRequest {
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: 'parcel-notify-default',
    chatBarText: '包裹選單',
    areas: ITEMS.map((item, i) => ({
      bounds: { x: Math.round((WIDTH / 4) * i), y: 0, width: Math.round(WIDTH / 4), height: HEIGHT },
      action: { type: 'message', label: item.label, text: item.text },
    })),
  };
}

/** 建立並設為預設的圖文選單 */
export async function installRichMenu(actor: Actor, channel: ChannelRow) {
  if (!channel.isActive) throw new DomainError('LINE 官方帳號未啟用');
  const image = await renderImage();
  let richMenuId: string;
  try {
    richMenuId = await lineGateway().createRichMenu(credsOf(channel), menuDefinition(), image, 'image/png');
  } catch (e) {
    console.error('[rich-menu] failed', e);
    throw new DomainError('建立圖文選單失敗，請確認 access token 仍然有效');
  }
  await db().update(schema.lineChannels).set({ richMenuId }).where(eq(schema.lineChannels.id, channel.id));
  await audit(actor, 'line.rich_menu', { communityId: channel.communityId, entityType: 'line_channel', entityId: channel.id, data: { richMenuId } });
  return richMenuId;
}
