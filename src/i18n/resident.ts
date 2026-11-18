/**
 * 住戶看到的文字（LINE 訊息、Email、住戶網頁）。住戶可以選語言，所以從一開始就走字典。
 * 後台介面目前只有繁體中文，英文版在第 2 階段補上。
 */
export const LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

const zh = {
  arrivalTitle: '您有包裹到了',
  reminderTitle: '包裹尚未領取提醒',
  pickupTitle: '包裹已領取',
  unit: '門牌',
  parcels: '件數',
  carrier: '物流',
  location: '存放',
  pickupCode: '取件碼',
  receivedAt: '到件時間',
  viewPickupQr: '出示取件 QR code',
  myParcels: '我的包裹',
  deskInfo: '管理室',
  pieces: '{n} 件',
  arrivalAlt: '📦 {unit} 有 {n} 件包裹在管理室，取件碼 {codes}',
  reminderAlt: '⏰ {unit} 還有 {n} 件包裹未領取，請盡快到管理室領取',
  pickupAlt: '✅ {unit} 的 {n} 件包裹已於 {time} 領取',
  pickupBy: '領取人',
  welcome:
    '歡迎使用{brand}！\n\n請輸入管理室提供的「8 碼綁定碼」完成綁定（或直接掃描綁定卡上的 QR code）。\n\n綁定後，包裹一到就會通知您。',
  bindOk: '✅ 綁定成功！\n{community} {unit}\n\n之後包裹一到就會通知您。點下方「我的包裹」可以查看待領包裹和取件 QR code。',
  bindAlready: '您已經綁定 {community} {unit} 了。',
  bindBadCode: '找不到這組綁定碼，請確認後再輸入（8 碼英數字）。',
  bindWrongChannel: '這組綁定碼不屬於這個官方帳號，請加入社區管理室提供的官方帳號後再綁定。',
  bindLocked: '輸入錯誤次數過多，請 1 小時後再試，或洽管理室。',
  notBound: '您還沒有綁定門牌。請輸入管理室提供的 8 碼綁定碼。',
  noParcels: '目前沒有待領取的包裹 👍',
  pendingHeader: '待領取包裹',
  help:
    '可以使用的指令：\n・我的包裹：查看待領包裹\n・取件碼：開啟取件 QR code\n・設定：通知與家人設定\n・輸入 8 碼綁定碼：綁定門牌',
  openPage: '開啟',
  settings: '設定',
  // 住戶網頁
  pageTitle: '我的包裹',
  waiting: '待領取',
  history: '最近領取',
  showQrHint: '到管理室時出示這個 QR code，管理員掃描後即可領取。',
  qrRefresh: 'QR code 每 10 分鐘自動更新',
  noHistory: '還沒有領取紀錄',
  notifications: '通知設定',
  notifyLine: '用 LINE 通知我',
  notifyEmail: '用 Email 通知我',
  email: 'Email',
  language: '語言',
  save: '儲存',
  saved: '已儲存',
  family: '同戶成員',
  you: '（你）',
  primary: '主要聯絡人',
  proxy: '代領',
  proxyHint: '請家人或朋友代領時，產生一組代領碼給對方，管理室輸入後即可交付。代領碼 24 小時內有效、只能用一次。',
  proxyName: '代領人姓名（選填）',
  proxyCreate: '產生代領碼',
  proxyCode: '代領碼',
  proxyExpires: '有效期限',
  linkInvalid: '這個連結已失效，請在 LINE 官方帳號輸入「我的包裹」取得新的連結。',
  unbind: '解除綁定',
  unbindConfirm: '確定要解除綁定嗎？解除後將不會再收到這戶的包裹通知。',
  unbound: '已解除綁定。',
  types: {
    cold: '冷藏',
    frozen: '冷凍',
    large: '大型',
    registered: '掛號',
    document: '文件',
    fragile: '易碎',
  } as Record<string, string>,
  emailFooter: '這封信由{brand}自動寄出。若要停止 Email 通知，請到住戶頁面的通知設定關閉。',
};

type Dict = typeof zh;

const en: Dict = {
  arrivalTitle: 'You have a parcel',
  reminderTitle: 'Parcel pickup reminder',
  pickupTitle: 'Parcel picked up',
  unit: 'Unit',
  parcels: 'Items',
  carrier: 'Carrier',
  location: 'Location',
  pickupCode: 'Pickup code',
  receivedAt: 'Received',
  viewPickupQr: 'Show pickup QR code',
  myParcels: 'My parcels',
  deskInfo: 'Front desk',
  pieces: '{n}',
  arrivalAlt: '📦 {n} parcel(s) for {unit} at the front desk. Pickup code {codes}',
  reminderAlt: '⏰ {n} parcel(s) for {unit} are still waiting for pickup',
  pickupAlt: '✅ {n} parcel(s) for {unit} were picked up at {time}',
  pickupBy: 'Picked up by',
  welcome:
    'Welcome to {brand}!\n\nPlease enter the 8-character binding code from the front desk (or scan the QR code on your binding card).\n\nWe will notify you as soon as a parcel arrives.',
  bindOk: '✅ Linked!\n{community} {unit}\n\nWe will notify you when parcels arrive. Tap "My parcels" to see pending parcels and your pickup QR code.',
  bindAlready: 'You are already linked to {community} {unit}.',
  bindBadCode: 'Binding code not found. Please check and try again (8 letters/digits).',
  bindWrongChannel: 'This binding code belongs to a different official account. Please add the account provided by your front desk.',
  bindLocked: 'Too many attempts. Please try again in an hour or contact the front desk.',
  notBound: 'You have not linked a unit yet. Please enter the 8-character binding code.',
  noParcels: 'No parcels waiting 👍',
  pendingHeader: 'Waiting for pickup',
  help:
    'Commands:\n・My parcels: see waiting parcels\n・Pickup: open your pickup QR code\n・Settings: notifications and household\n・Enter an 8-character code to link a unit',
  openPage: 'Open',
  settings: 'Settings',
  pageTitle: 'My parcels',
  waiting: 'Waiting',
  history: 'Recently picked up',
  showQrHint: 'Show this QR code at the front desk to pick up your parcels.',
  qrRefresh: 'The QR code refreshes every 10 minutes',
  noHistory: 'No pickups yet',
  notifications: 'Notifications',
  notifyLine: 'Notify me on LINE',
  notifyEmail: 'Notify me by email',
  email: 'Email',
  language: 'Language',
  save: 'Save',
  saved: 'Saved',
  family: 'Household',
  you: '(you)',
  primary: 'Primary contact',
  proxy: 'Proxy pickup',
  proxyHint: 'Create a one-time code for a family member or friend to pick up on your behalf. Valid for 24 hours.',
  proxyName: 'Name of the person (optional)',
  proxyCreate: 'Create proxy code',
  proxyCode: 'Proxy code',
  proxyExpires: 'Expires',
  linkInvalid: 'This link has expired. Send "My parcels" to the official account to get a new link.',
  unbind: 'Unlink',
  unbindConfirm: 'Unlink this unit? You will stop receiving parcel notifications for it.',
  unbound: 'Unlinked.',
  types: {
    cold: 'Chilled',
    frozen: 'Frozen',
    large: 'Large',
    registered: 'Registered',
    document: 'Document',
    fragile: 'Fragile',
  },
  emailFooter: 'This email was sent automatically by {brand}. You can turn off email notifications in your resident page settings.',
};

const dicts: Record<Lang, Dict> = { 'zh-TW': zh, en };

export function dict(lang: string | null | undefined): Dict {
  return dicts[(lang as Lang) in dicts ? (lang as Lang) : 'zh-TW'];
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** 住戶在 LINE 輸入的指令（中英文都可以） */
export const COMMANDS = {
  parcels: ['我的包裹', '包裹', '查詢', '查包裹', 'my parcels', 'parcels'],
  pickup: ['取件碼', '取件', '領取', 'pickup', 'qr'],
  settings: ['設定', '通知設定', 'settings'],
  help: ['說明', '幫助', '綁定', 'help', '?', '？'],
};
