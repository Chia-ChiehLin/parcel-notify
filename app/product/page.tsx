import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { brandName, serviceContact } from '@/lib/env';
import { publicProductUrl } from '@/lib/product-url';

const description = '提供社區管委會與物業公司的包裹管理系統。櫃台用平板登記，住戶透過 LINE 收到通知並出示 QR code 領件，管理者可查詢交付紀錄。';

export function generateMetadata(): Metadata {
  const name = brandName();
  const title = `${name}｜社區包裹管理系統`;
  const url = publicProductUrl();
  return {
    title: { absolute: title },
    description,
    robots: { index: !!url, follow: false },
    alternates: url ? { canonical: url } : undefined,
    openGraph: { title, description, url, siteName: name, locale: 'zh_TW', type: 'website' },
  };
}

const steps = [
  ['櫃台收件', '選擇戶號、記下存放位置。多件包裹可連續登記，同一戶合併發送一則到件通知。'],
  ['住戶收通知', '住戶綁定社區的 LINE 官方帳號，就能收到包裹通知、查詢待領件，也能產生代領碼。'],
  ['核對後交付', '櫃台掃描住戶手機上的 QR code，或輸入取件碼，核對包裹後交付。取件時間與經手人員都有紀錄。'],
];

export default function ProductPage() {
  const brand = brandName();
  const { email, operator } = serviceContact();
  return (
    <main className="min-h-screen bg-[#faf9f5] text-[#153e3a]">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 border-b border-[#cedad4] px-5 py-5 sm:px-9">
        <Link href="/product" className="flex items-center gap-2 font-bold"><Logo className="h-8 w-8" />{brand}</Link>
        <Link href="/login" className="rounded-md border border-[#71978d] px-4 py-2 text-sm font-semibold hover:bg-brand-50">管理室登入</Link>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-9 px-5 py-12 sm:px-9 md:grid-cols-[1.15fr_0.85fr] md:gap-12 md:py-20">
        <div>
          <p className="mb-4 text-sm font-bold tracking-wider text-brand-700">社區包裹管理系統</p>
          <h1 className="text-[clamp(1.75rem,9vw,2.25rem)] font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">包裹到管理室，<br />住戶用 LINE 領件。</h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-[#3e5852]">{brand}讓櫃台在平板上完成收件、通知與交付。管委會能查到每件包裹的去向，物業公司也能管理旗下社區。</p>
          {!email ? <p className="mt-4 text-sm text-[#455952]">社區試用由服務商開通。請透過與你洽談的業務窗口提供社區名稱與戶數。</p> : null}
          <div className="mt-7 flex flex-wrap gap-3">
            {email ? <a href={`mailto:${email}?subject=${encodeURIComponent(brand + '｜社區導入洽詢')}`} className="rounded-lg bg-brand-800 px-5 py-3 font-semibold text-white hover:bg-brand-900">洽詢社區導入</a> : null}
            <a href="#workflow" className="rounded-lg border border-brand-800 px-5 py-3 font-semibold hover:bg-brand-50">查看收件流程 ↓</a>
          </div>
        </div>
        <figure className="rounded-3xl bg-[#dce9e3] p-5 sm:p-8">
          <div className="mx-auto max-w-sm rounded-xl border border-[#b4c7bc] bg-[#fffefa] shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-dashed border-[#a5b8af] px-5 py-4">
              <span className="text-sm font-semibold text-brand-800">{brand}</span><span className="text-xs text-gray-600">取件通知單範例</span>
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-sm text-gray-600">領取門牌</p>
              <p className="my-2 text-4xl font-bold tracking-tight">A 棟 3 樓之 1</p>
              <dl className="mt-5 divide-y divide-[#e0e6df] text-sm">
                <div className="flex justify-between gap-3 py-2"><dt>待領包裹</dt><dd className="font-semibold">1 件</dd></div>
                <div className="flex justify-between gap-3 py-2"><dt>存放位置</dt><dd className="font-semibold">管理室・冷藏櫃</dd></div>
              </dl>
            </div>
          </div>
          <figcaption className="mt-4 text-center text-xs leading-5 text-[#3e5852]">尚未綁定 LINE 的住戶，也能使用紙本通知單領件。</figcaption>
        </figure>
      </section>
      <section id="workflow" className="border-y border-[#d3ddd4] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-9 sm:py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">從到件通知到領取紀錄</h2>
          <ol className="mt-7 grid gap-6 md:grid-cols-3">
            {steps.map(([heading, detail]) => (
              <li key={heading} className="border-t-2 border-brand-700 pt-4">
                <h3 className="text-lg font-bold">{heading}</h3>
                <p className="mt-2 leading-7 text-[#455952]">{detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-[#455952] sm:px-9">
        <span>{operator ? `${brand}・${operator}` : brand}</span>
        <nav aria-label="服務資訊" className="flex gap-5"><Link className="underline" href="/privacy">隱私權政策</Link><Link className="underline" href="/terms">服務條款</Link></nav>
      </footer>
    </main>
  );
}
