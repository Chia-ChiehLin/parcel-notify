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
  if (blobEnabled()) {
    const { get } = await import('@vercel/blob');
    const res = await get(key, { access: 'private' });
    if (!res || res.statusCode !== 200) return null;
    return { body: res.stream, contentType: res.blob.contentType };
  }
  const [row] = await db().select().from(schema.files).where(eq(schema.files.key, key)).limit(1);
  return row ? { body: row.data, contentType: row.contentType } : null;
}

export async function deleteFiles(keys: string[]) {
  const list = keys.filter(Boolean);
  if (!list.length) return;
  if (blobEnabled()) {
    const { del } = await import('@vercel/blob');
    for (let i = 0; i < list.length; i += 100) await del(list.slice(i, i + 100));
  } else {
    await db().delete(schema.files).where(inArray(schema.files.key, list));
  }
}

/** 從 data URL 或上傳的檔案取出圖片內容，只接受 JPEG/PNG/WebP，大小上限 3MB */
export function decodeImage(input: string | File | null | undefined): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
  return (async () => {
    if (!input) return null;
    let data: Buffer;
    let contentType: string;
    if (typeof input === 'string') {
      const m = input.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return null;
      contentType = m[1];
      data = Buffer.from(m[2], 'base64');
    } else {
      if (input.size === 0) return null;
      contentType = input.type;
      data = Buffer.from(await input.arrayBuffer());
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('只接受 JPEG、PNG 或 WebP 圖片');
    if (data.length > 3 * 1024 * 1024) throw new Error('圖片太大（上限 3MB）');
    // 檢查檔頭，避免假冒副檔名
    const isJpeg = data[0] === 0xff && data[1] === 0xd8;
    const isPng = data[0] === 0x89 && data[1] === 0x50;
    const isWebp = data.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) throw new Error('圖片格式不正確');
    const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    return { data, contentType: isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp', ext };
  })();
}
