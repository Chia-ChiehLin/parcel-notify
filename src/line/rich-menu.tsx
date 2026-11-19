import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  { label: '我的包裹', text: '我的包裹' },
  { label: '取件 QR', text: '取件碼' },
  { label: '通知設定', text: '設定' },
  { label: '使用說明', text: '說明' },
];

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
  const image = await readFile(join(process.cwd(), 'src/line/assets/rich-menu.png'));
  return db().transaction(async (tx) => {
    const [current] = await tx.select().from(schema.lineChannels).where(eq(schema.lineChannels.id, channel.id)).for('update');
    if (!current?.isActive) throw new DomainError('LINE 官方帳號未啟用');
    if (current.richMenuId !== channel.richMenuId) throw new DomainError('本系統的圖文選單剛由其他人更新，請重新整理後確認。');
    let richMenuId: string;
    try {
      richMenuId = await lineGateway().createRichMenu(credsOf(current), menuDefinition(), image, 'image/png', current.richMenuId);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('LINE 未確認圖文選單設定成功。請核對官方帳號目前的選單及 access token 權限，再決定是否重試。');
    }
    await tx.update(schema.lineChannels).set({ richMenuId }).where(eq(schema.lineChannels.id, current.id));
    await audit(actor, 'line.rich_menu', { communityId: current.communityId, entityType: 'line_channel', entityId: current.id, data: { richMenuId } }, tx);
    return richMenuId;
  });
}
