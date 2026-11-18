import type { Metadata, Viewport } from 'next';
import { brandName } from '@/lib/env';
import './globals.css';

export function generateMetadata(): Metadata {
  return {
    title: { default: brandName(), template: `%s｜${brandName()}` },
    description: '社區包裹登記、LINE 通知與領取管理系統',
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
