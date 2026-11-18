import Link from 'next/link';
import { residentFromToken } from '@/domain/resident-session';
import { listUnitMembers } from '@/domain/residents';
import { dict, LANGUAGES } from '@/i18n/resident';
import { SettingsForm, UnbindButton } from './form';

export const dynamic = 'force-dynamic';

export default async function ResidentSettings({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await residentFromToken(token);
  if (!r) return <p className="p-8 text-center text-gray-600">{dict('zh-TW').linkInvalid}</p>;
  const d = dict(r.resident.language);
  const members = await listUnitMembers(r.unit.id);
  return (
    <>
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
          <SettingsForm
            token={token}
            hasLine={!!r.resident.lineUserId}
            defaults={{ notifyLine: r.resident.notifyLine, notifyEmail: r.resident.notifyEmail, email: r.resident.email ?? '', language: r.resident.language }}
            languages={LANGUAGES.map((l) => ({ code: l.code, label: l.label }))}
            labels={{ notifyLine: d.notifyLine, notifyEmail: d.notifyEmail, email: d.email, language: d.language, save: d.save }}
          />
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
    </>
  );
}
