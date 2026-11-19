import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDaily } from '@/domain/maintenance';
import { validateDeploymentSecrets } from '@/lib/env';
import { publicProductUrl } from '@/lib/product-url';
import { GET } from '../app/api/cron/daily/route';
import robots from '../app/robots';
import sitemap from '../app/sitemap';

vi.mock('@/domain/maintenance', () => ({ runDaily: vi.fn() }));

describe('獨立驗收站的 Production 部署', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PARCEL_ENV', 'staging');
    vi.stubEnv('APP_SECRET', 'x'.repeat(64));
    vi.stubEnv('APP_URL', 'https://parcel-test.example.com');
    vi.stubEnv('CRON_SECRET', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('建置可略過排程密鑰，主金鑰仍須符合長度', () => {
    expect(() => validateDeploymentSecrets()).not.toThrow();
    vi.stubEnv('APP_SECRET', 'short');
    expect(() => validateDeploymentSecrets()).toThrow('APP_SECRET');
  });

  it('不公開搜尋連結，即使排程取得有效密鑰也不執行每日維護', async () => {
    expect(publicProductUrl()).toBeUndefined();
    expect(sitemap()).toEqual([]);
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
    vi.stubEnv('CRON_SECRET', 'isolated-cron-test');
    const res = await GET(new Request('https://parcel-test.example.com/api/cron/daily', {
      headers: { authorization: 'Bearer isolated-cron-test' },
    }));
    expect(res.status).toBe(204);
    expect(runDaily).not.toHaveBeenCalled();
  });

  it('一般正式站仍需要排程密鑰，也仍提供品牌頁標準網址', async () => {
    vi.stubEnv('PARCEL_ENV', undefined);
    expect(() => validateDeploymentSecrets()).toThrow('CRON_SECRET');
    expect(publicProductUrl()?.href).toBe('https://parcel-test.example.com/product');
    const res = await GET(new Request('https://parcel-test.example.com/api/cron/daily'));
    expect(res.status).toBe(401);
    expect(runDaily).not.toHaveBeenCalled();
  });
});
