'use client';

import { useState } from 'react';

const BAR = '#0d9488';

/** 每日收件量直條圖：單一數列（不需圖例），游標移到柱子上顯示數值 */
export function DailyColumns({ data, label }: { data: { day: string; n: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.n));
  const peak = data.reduce((best, d, i) => (d.n > data[best].n ? i : best), 0);
  const H = 160;
  return (
    <figure aria-label={label}>
      <div className="relative" style={{ height: H + 24 }}>
        {/* 格線 */}
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-gray-100" style={{ top: H - H * f }}>
            <span className="absolute -top-2 right-full mr-2 text-[10px] text-gray-400 tabular">{Math.round(max * f)}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 top-0 flex items-end" style={{ height: H }}>
          {data.map((d, i) => {
            const h = d.n ? Math.max(3, (d.n / max) * H) : 0;
            const showLabel = i === peak || i === data.length - 1;
            return (
              <div
                key={d.day}
                className="relative flex h-full flex-1 items-end justify-center px-[1px]"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.day} ${d.n} 件`}
              >
                {showLabel && d.n > 0 && hover === null ? (
                  <span className="absolute text-[11px] font-semibold text-gray-700 tabular" style={{ bottom: h + 4 }}>
                    {d.n}
                  </span>
                ) : null}
                <div
                  className="w-full max-w-6 rounded-t-[4px] transition-opacity"
                  style={{ height: h, background: BAR, opacity: hover === null || hover === i ? 1 : 0.45 }}
                />
                {hover === i ? (
                  <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow" style={{ bottom: h + 8 }}>
                    {d.day.slice(5)}・<b className="tabular">{d.n}</b> 件
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 border-t border-gray-300" style={{ top: H }} />
        <div className="absolute inset-x-0 flex text-[10px] text-gray-400" style={{ top: H + 6 }}>
          {data.map((d, i) => (
            <span key={d.day} className="flex-1 text-center tabular">
              {i % 2 === data.length % 2 ? '' : d.day.slice(5).replace('-', '/')}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th>{d.day}</th>
              <td>{d.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 依數量排序的橫條圖，數值標在條末（文字用一般文字色，不用資料色） */
export function RankedBars({ data, label }: { data: { name: string; n: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  if (!data.length) return <p className="py-6 text-center text-sm text-gray-500">還沒有資料</p>;
  return (
    <ul aria-label={label} className="space-y-2.5">
      {data.map((d) => (
        <li key={d.name} className="grid grid-cols-[7rem_1fr] items-center gap-3 text-sm" title={`${d.name}：${d.n} 件`}>
          <span className="truncate text-gray-700">{d.name}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-r-[4px]" style={{ width: `${Math.max(2, (d.n / max) * 85)}%`, background: BAR }} />
            <span className="text-xs font-semibold text-gray-700 tabular">{d.n}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
