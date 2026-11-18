import type { CommunityStatus, NotifyStatus, ParcelStatus } from '@/db/schema';
import { STATUS_LABELS as COMMUNITY_STATUS } from '@/domain/communities';
import { STATUS_LABELS as PARCEL_STATUS } from '@/domain/parcels';
import { CATEGORY_LABELS } from '@/domain/settings';
import { Badge } from './ui';

export function CommunityStatusBadge({ status }: { status: CommunityStatus }) {
  const tone = ({ trial: 'blue', active: 'green', suspended: 'red', cancelled: 'gray' } as const)[status];
  return <Badge tone={tone}>{COMMUNITY_STATUS[status]}</Badge>;
}

export function ParcelStatusBadge({ status, overdue }: { status: ParcelStatus; overdue?: boolean }) {
  if (status === 'waiting' && overdue) return <Badge tone="red">逾期未領</Badge>;
  const tone = ({ waiting: 'yellow', picked_up: 'green', returned: 'purple', cancelled: 'gray' } as const)[status];
  return <Badge tone={tone}>{PARCEL_STATUS[status]}</Badge>;
}

const NOTIFY_LABELS: Record<NotifyStatus, [string, 'green' | 'yellow' | 'red' | 'gray' | 'blue']> = {
  pending: ['未通知', 'gray'],
  sent: ['已通知', 'green'],
  partial: ['部分成功', 'yellow'],
  failed: ['通知失敗', 'red'],
  no_recipient: ['未綁定', 'gray'],
  skipped: ['未發送', 'gray'],
};

export function NotifyBadge({ status }: { status: NotifyStatus }) {
  const [label, tone] = NOTIFY_LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const CATEGORY_TONES: Record<string, 'blue' | 'purple' | 'red' | 'yellow' | 'gray'> = {
  frozen: 'blue',
  cold: 'blue',
  large: 'purple',
  registered: 'red',
  fragile: 'yellow',
  document: 'gray',
};

export function CategoryBadges({ categories }: { categories: string[] }) {
  if (!categories.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {categories.map((c) => (
        <Badge key={c} tone={CATEGORY_TONES[c] ?? 'gray'}>
          {CATEGORY_LABELS[c] ?? c}
        </Badge>
      ))}
    </span>
  );
}
