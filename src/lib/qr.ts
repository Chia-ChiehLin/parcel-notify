import QRCode from 'qrcode';

/** 伺服器端產生 QR code SVG 字串 */
export async function qrSvg(text: string, opts: { margin?: number; dark?: string } = {}) {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: opts.margin ?? 1,
    color: { dark: opts.dark ?? '#111827', light: '#ffffff' },
  });
}
