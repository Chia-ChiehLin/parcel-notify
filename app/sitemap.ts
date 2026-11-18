import type { MetadataRoute } from 'next';
import { publicProductUrl } from '@/lib/product-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const url = publicProductUrl();
  return url ? [{ url: url.href }] : [];
}
