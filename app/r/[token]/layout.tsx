import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '我的包裹',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResidentLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-10">{children}</div>;
}
