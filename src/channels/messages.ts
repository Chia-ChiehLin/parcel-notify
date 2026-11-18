import type { messagingApi } from '@line/bot-sdk';
import { dict, fill } from '@/i18n/resident';
import { formatDateTime } from '@/lib/time';
import { brandName } from '@/lib/env';

export type ParcelSummary = {
  carrier: string | null;
  categories: string[];
  storageLocation: string | null;
  quantity: number;
  pickupCode: string;
  receivedAt: Date;
};

export type ArrivalContext = {
  kind: 'arrival' | 'reminder';
  lang: string;
  communityName: string;
  unitLabel: string;
  parcels: ParcelSummary[];
  link: string;
  deskPhone?: string;
  deskHours?: string;
};

const BRAND_COLOR = '#0F766E';
const WARN_COLOR = '#B45309';
const CATEGORY_COLORS: Record<string, string> = {
  frozen: '#1D4ED8',
  cold: '#0369A1',
  large: '#7C3AED',
  registered: '#B91C1C',
  fragile: '#C2410C',
  document: '#475569',
};

export function totalPieces(parcels: { quantity: number }[]) {
  return parcels.reduce((s, p) => s + (p.quantity || 1), 0);
}

export function arrivalAltText(ctx: ArrivalContext) {
  const d = dict(ctx.lang);
  const n = totalPieces(ctx.parcels);
  return ctx.kind === 'reminder'
    ? fill(d.reminderAlt, { unit: ctx.unitLabel, n })
    : fill(d.arrivalAlt, { unit: ctx.unitLabel, n, codes: ctx.parcels.map((p) => p.pickupCode).join('、') });
}

/** LINE Flex 卡片：多件包裹合併成一則訊息 */
export function arrivalFlex(ctx: ArrivalContext): messagingApi.FlexMessage {
  const d = dict(ctx.lang);
  const isReminder = ctx.kind === 'reminder';
  const color = isReminder ? WARN_COLOR : BRAND_COLOR;
  const shown = ctx.parcels.slice(0, 8);
  const rows: messagingApi.FlexComponent[] = shown.map((p, i) => {
    const details = [p.carrier, p.storageLocation, p.quantity > 1 ? fill(d.pieces, { n: p.quantity }) : null].filter(Boolean).join(' ・ ');
    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      paddingTop: i === 0 ? 'none' : 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `${d.pickupCode} ${p.pickupCode}`, weight: 'bold', size: 'md', color: '#111827', flex: 1 },
            ...p.categories.slice(0, 3).map(
              (c): messagingApi.FlexComponent => ({
                type: 'box',
                layout: 'vertical',
                flex: 0,
                backgroundColor: CATEGORY_COLORS[c] ?? '#475569',
                cornerRadius: '4px',
                paddingStart: '6px',
                paddingEnd: '6px',
                paddingTop: '2px',
                paddingBottom: '2px',
                margin: 'sm',
                contents: [{ type: 'text', text: d.types[c] ?? c, size: 'xxs', color: '#FFFFFF', weight: 'bold' }],
              }),
            ),
          ],
        },
        ...(details ? [{ type: 'text', text: details, size: 'xs', color: '#6B7280', wrap: true } as messagingApi.FlexComponent] : []),
        { type: 'text', text: `${d.receivedAt} ${formatDateTime(p.receivedAt)}`, size: 'xxs', color: '#9CA3AF' },
      ],
    };
  });
  if (ctx.parcels.length > shown.length) {
    rows.push({ type: 'text', text: `…+${ctx.parcels.length - shown.length}`, size: 'xs', color: '#6B7280' });
  }
  const desk = [ctx.deskPhone, ctx.deskHours].filter(Boolean).join(' ・ ');
  return {
    type: 'flex',
    altText: arrivalAltText(ctx),
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: isReminder ? d.reminderTitle : d.arrivalTitle, color: '#FFFFFF', weight: 'bold', size: 'lg' },
          {
            type: 'text',
            text: `${ctx.communityName} ${ctx.unitLabel} ・ ${fill(d.pieces, { n: totalPieces(ctx.parcels) })}`,
            color: '#FFFFFFCC',
            size: 'sm',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'lg',
        contents: [
          ...rows,
          ...(desk
            ? [
                { type: 'separator', margin: 'lg' } as messagingApi.FlexComponent,
                { type: 'text', text: `${d.deskInfo} ${desk}`, size: 'xs', color: '#6B7280', margin: 'md', wrap: true } as messagingApi.FlexComponent,
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color,
            height: 'sm',
            action: { type: 'uri', label: d.viewPickupQr, uri: ctx.link },
          },
        ],
      },
    },
  };
}

export function pickupText(lang: string, unitLabel: string, n: number, at: Date, by?: string | null) {
  const d = dict(lang);
  const base = fill(d.pickupAlt, { unit: unitLabel, n, time: formatDateTime(at) });
  return by ? `${base}\n${d.pickupBy}：${by}` : base;
}

/** 住戶在 LINE 查詢「我的包裹」時的回覆（回覆訊息不計費） */
export function pendingListMessage(
  lang: string,
  groups: { communityName: string; unitLabel: string; parcels: ParcelSummary[]; link: string }[],
): messagingApi.Message[] {
  const d = dict(lang);
  if (!groups.length || groups.every((g) => g.parcels.length === 0)) {
    const link = groups[0]?.link;
    return [
      link
        ? {
            type: 'template',
            altText: d.noParcels,
            template: { type: 'buttons', text: d.noParcels, actions: [{ type: 'uri', label: d.myParcels, uri: link }] },
          }
        : { type: 'text', text: d.noParcels },
    ];
  }
  return groups
    .filter((g) => g.parcels.length)
    .slice(0, 5)
    .map((g) =>
      arrivalFlex({ kind: 'arrival', lang, communityName: g.communityName, unitLabel: g.unitLabel, parcels: g.parcels, link: g.link }),
    );
}

export function linkButtons(lang: string, text: string, label: string, link: string): messagingApi.Message {
  return {
    type: 'template',
    altText: text,
    template: { type: 'buttons', text: text.slice(0, 160), actions: [{ type: 'uri', label: label.slice(0, 20), uri: link }] },
  };
}

// ───────────────────────────── Email ─────────────────────────────

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function arrivalEmail(ctx: ArrivalContext) {
  const d = dict(ctx.lang);
  const title = ctx.kind === 'reminder' ? d.reminderTitle : d.arrivalTitle;
  const subject = `${title}｜${ctx.communityName} ${ctx.unitLabel}`;
  const items = ctx.parcels
    .map((p) => {
      const tags = p.categories.map((c) => d.types[c] ?? c).join('、');
      const details = [p.carrier, p.storageLocation, tags, p.quantity > 1 ? fill(d.pieces, { n: p.quantity }) : null].filter(Boolean).join(' ・ ');
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb"><div style="font-weight:700;font-size:16px">${esc(d.pickupCode)} ${esc(p.pickupCode)}</div><div style="color:#6b7280;font-size:13px">${esc(details)}</div><div style="color:#9ca3af;font-size:12px">${esc(d.receivedAt)} ${esc(formatDateTime(p.receivedAt))}</div></td></tr>`;
    })
    .join('');
  const desk = [ctx.deskPhone, ctx.deskHours].filter(Boolean).join(' ・ ');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif"><div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden"><div style="background:${ctx.kind === 'reminder' ? WARN_COLOR : BRAND_COLOR};color:#fff;padding:20px"><div style="font-size:20px;font-weight:700">${esc(title)}</div><div style="opacity:.85">${esc(ctx.communityName)} ${esc(ctx.unitLabel)}</div></div><div style="padding:8px 20px 20px"><table style="width:100%;border-collapse:collapse">${items}</table>${desk ? `<p style="color:#6b7280;font-size:13px">${esc(d.deskInfo)} ${esc(desk)}</p>` : ''}<a href="${esc(ctx.link)}" style="display:block;text-align:center;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px;border-radius:8px;font-weight:700;margin-top:12px">${esc(d.viewPickupQr)}</a></div></div><p style="text-align:center;color:#9ca3af;font-size:12px;padding:0 16px">${esc(fill(d.emailFooter, { brand: brandName() }))}</p></body></html>`;
  const text = `${title}\n${ctx.communityName} ${ctx.unitLabel}\n\n${ctx.parcels
    .map((p) => `${d.pickupCode} ${p.pickupCode} ${[p.carrier, p.storageLocation].filter(Boolean).join(' ')}`)
    .join('\n')}\n\n${d.viewPickupQr}: ${ctx.link}`;
  return { subject, html, text };
}

export function simpleEmail(subject: string, lines: string[], action?: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif"><div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;padding:24px"><h2 style="margin:0 0 12px;color:#111827">${esc(subject)}</h2>${lines
    .map((l) => `<p style="color:#374151;line-height:1.6">${esc(l)}</p>`)
    .join('')}${action ? `<a href="${esc(action.url)}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">${esc(action.label)}</a><p style="color:#9ca3af;font-size:12px;word-break:break-all">${esc(action.url)}</p>` : ''}</div><p style="text-align:center;color:#9ca3af;font-size:12px">${esc(brandName())}</p></body></html>`;
  const text = `${subject}\n\n${lines.join('\n')}${action ? `\n\n${action.label}: ${action.url}` : ''}`;
  return { subject, html, text };
}
