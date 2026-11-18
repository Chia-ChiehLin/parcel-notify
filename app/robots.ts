import type { MetadataRoute } from 'next';
import { publicProductUrl } from '@/lib/product-url';

export default function robots(): MetadataRoute.Robots {
  const product = publicProductUrl();
  return {
    rules: { userAgent: '*', disallow: '/', ...(product ? { allow: ['/$', '/product$', '/sitemap.xml$', '/_next/static/'] } : {}) },
    sitemap: product ? new URL('/sitemap.xml', product).href : undefined,
  };
}
