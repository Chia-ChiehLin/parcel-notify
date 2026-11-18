import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { randomToken } from '@/lib/crypto';

/**
 * 檔案儲存：有 BLOB_READ_WRITE_TOKEN 時存到 Vercel Blob（private，只能透過我們的權限路由讀取），
 * 否則存到資料庫（本機開發、測試）。
 */
const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function newFileKey(communityId: string, kind: 'photo' | 'signature', ext: string) {
  return `c/${communityId}/${kind}/${randomToken(18)}.${ext}`;
}

export async function putFile(communityId: string, key: string, data: Buffer, contentType: string) {
  if (blobEnabled()) {
    const { put } = await import('@vercel/blob');
    await put(key, data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
  } else {
    await db().insert(schema.files).values({ key, communityId, contentType, size: data.length, data });
  }
  return key;
}

export async function getFile(key: string): Promise<{ body: ReadableStream<Uint8Array> | Buffer; contentType: string } | null> {
  // 啟用 Blob 以前存進資料庫的舊檔案仍可讀取。
  const [row] = await db().select({ data: schema.files.data, contentType: schema.files.contentType })
    .from(schema.files).where(eq(schema.files.key, key)).limit(1);
  if (row) return { body: row.data, contentType: row.contentType };
  if (!blobEnabled()) return null;
  const { get } = await import('@vercel/blob');
  const res = await get(key, { access: 'private' });
  return res?.statusCode === 200 ? { body: res.stream, contentType: res.blob.contentType } : null;
}

export async function deleteFiles(keys: string[]) {
  const list = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const group = list.slice(i, i + 100);
    const removed = await db().delete(schema.files).where(inArray(schema.files.key, group)).returning({ key: schema.files.key });
    if (blobEnabled() && removed.length < group.length) {
      const localKeys = new Set(removed.map((r) => r.key));
      const { del } = await import('@vercel/blob');
      await del(group.filter((key) => !localKeys.has(key)));
    }
  }
}

/** 從 data URL 或上傳的檔案取出圖片內容，只接受 JPEG/PNG/WebP，大小上限 3MB */
export async function decodeImage(input: string | File | null | undefined): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
  if (!input || (typeof input !== 'string' && input.size === 0)) return null;
  const maxBytes = 3 * 1024 * 1024;
  const tooLarge = '圖片太大（上限 3MB）';
  let data: Buffer;
  let contentType: string;
  if (typeof input === 'string') {
    if (input.length > Math.ceil(maxBytes / 3) * 4 + 32) throw new Error(tooLarge);
    const match = input.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
    if (!match) throw new Error('圖片格式不正確，請重新選取或簽名');
    contentType = match[1];
    data = Buffer.from(match[2], 'base64');
  } else {
    if (input.size > maxBytes) throw new Error(tooLarge);
    contentType = input.type;
    data = Buffer.from(await input.arrayBuffer());
  }
  if (data.length > maxBytes) throw new Error(tooLarge);
  if (contentType === 'image/jpeg' && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { data, contentType, ext: 'jpg' };
  }
  if (contentType === 'image/png' && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { data, contentType, ext: 'png' };
  }
  if (contentType === 'image/webp' && data.subarray(0, 4).equals(Buffer.from('RIFF')) && data.subarray(8, 12).equals(Buffer.from('WEBP'))) {
    return { data, contentType, ext: 'webp' };
  }
  throw new Error('圖片格式不正確，支援 JPEG、PNG 或 WebP');
}
