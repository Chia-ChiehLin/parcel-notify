import { verifyOwnEmailAction } from '@/actions/resident';
import { EmailVerificationForm } from '@/components/email-verification-form';
import { parseSettings } from '@/domain/settings';
import { verificationMessage } from '@/domain/resident-email';
import Link from 'next/link';
import { residentFromToken } from '@/domain/resident-session';
import { listUnitMembers } from '@/domain/residents';
import { dict, LANGUAGES } from '@/i18n/resident';
import { SettingsForm, UnbindButton } from './form';

export const dynamic = 'force-dynamic';

export default async function ResidentSettings({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ email?: string }> }) {
  const { token } = await params;
  const r = await residentFromToken(token);
  if (!r) return <p className="p-8 text-center text-gray-600">{dict('zh-TW').linkInvalid}</p>;
  const d = dict(r.resident.language);
  const en = r.resident.language === 'en';
  const verified = !!r.resident.emailVerifiedAt && r.resident.verifiedEmail === r.resident.email;
  const result = (await searchParams).email;
  const hint = result === 'sent' || result === 'limited' || result === 'unavailable' ? verificationMessage(result, r.resident.language) : null;
  const members = await listUnitMembers(r.community.id, r.unit.id);
  return (
    <main lang={r.resident.language === 'en' ? 'en' : 'zh-Hant'}>
      <header className="bg-brand-700 px-5 pb-6 pt-8 text-white">
        <Link href={`/r/${token}`} className="text-sm opacity-80">
          ← {d.myParcels}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{d.settings}</h1>
        <div className="text-sm opacity-80">
          {r.community.name} {r.unit.label}
        </div>
      </header>
      <section className="-mt-3 px-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-bold">{d.notifications}</h2>
          {!r.features.email ? <p className="mb-3 text-sm">{en ? 'Your community plan currently does not include email notifications.' : '社區目前的方案未提供 Email 通知。'}</p> : null}
          <SettingsForm
            token={token}
            fallbackAllowed={parseSettings(r.community.settings).emailFallback}
            hasLine={!!r.resident.lineUserId}
            defaults={{ notifyLine: r.resident.notifyLine, notifyEmail: r.resident.notifyEmail, emailFallbackOnly: r.resident.emailFallbackOnly, email: r.resident.email ?? '', language: r.resident.language }}
            languages={LANGUAGES.map((l) => ({ code: l.code, label: l.label }))}
            labels={{ notifyLine: d.notifyLine, notifyEmail: d.notifyEmail, email: d.email, language: d.language, save: d.save }}
          />
          {r.resident.notifyEmail && r.resident.email ? (
            <div className="mt-5 border-t border-gray-200 pt-4">
              <p className="mb-2 text-sm">{verified ? (en ? 'Email verified' : '信箱已驗證') : verificationMessage('pending', r.resident.language)}</p>
              {hint && !verified ? <p role="status" className="mb-2 text-sm">{hint}</p> : null}
              {!verified && r.features.email ? <EmailVerificationForm action={verifyOwnEmailAction.bind(null, token)} english={en} /> : null}
            </div>
          ) : null}
        </div>
      </section>
      <section className="mt-4 px-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-lg font-bold">{d.family}</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <span>
                  {m.displayName || '—'} {m.id === r.resident.id ? <span className="text-gray-400">{d.you}</span> : null}
                </span>
                {m.isPrimary ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">{d.primary}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="mt-4 px-4">
        <UnbindButton token={token} label={d.unbind} confirmText={d.unbindConfirm} />
      </section>
    </main>
  );
}
