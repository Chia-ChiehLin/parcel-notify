'use client';

import { useRouter } from 'next/navigation';

export function CommunitySwitcher({ current, communities, isPlatformAdmin }: { current: string; communities: { slug: string; name: string }[]; isPlatformAdmin: boolean }) {
  const router = useRouter();
  return (
    <select
      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
      value={current}
      onChange={(e) => router.push(e.target.value === '__admin' ? '/admin' : `/c/${e.target.value}`)}
      aria-label="切換社區"
    >
      {isPlatformAdmin ? <option value="__admin">← 回平台總後台</option> : null}
      {communities.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
