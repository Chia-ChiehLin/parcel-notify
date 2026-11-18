import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 相機只給本站使用（掃條碼、拍照）
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 專案根目錄就是這個資料夾（避免上層目錄有 package-lock.json 時 Next.js 誤判）
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['@node-rs/argon2'],
  experimental: {
    serverActions: {
      // 包裹照片在前端已壓縮到 ~200KB，留一些餘裕
      bodySizeLimit: '4mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
