import type { schema } from '@/db';
import { AUDIT_ACTION_LABELS } from '@/domain/audit';
import { formatDateTime } from '@/lib/time';
import { Badge, Table, Td, Th } from './ui';

const ACTOR_LABEL = { user: '人員', resident: '住戶', system: '系統', line: 'LINE' } as const;

function summarize(data: Record<string, unknown> | null) {
  if (!data) return '';
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('・')
    .slice(0, 240);
}

export function AuditTable({ rows, showCommunity }: { rows: { log: typeof schema.auditLogs.$inferSelect; communityName?: string | null }[]; showCommunity?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>時間</Th>
          {showCommunity ? <Th>社區</Th> : null}
          <Th>操作者</Th>
          <Th>動作</Th>
          <Th>內容</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map(({ log, communityName }) => (
          <tr key={log.id}>
            <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(log.createdAt)}</Td>
            {showCommunity ? <Td className="text-sm">{communityName ?? '—'}</Td> : null}
            <Td className="whitespace-nowrap text-sm">
              <Badge tone="gray">{ACTOR_LABEL[log.actorType]}</Badge> {log.actorName}
            </Td>
            <Td className="whitespace-nowrap text-sm font-medium">{AUDIT_ACTION_LABELS[log.action] ?? log.action}</Td>
            <Td className="max-w-md break-all text-xs text-gray-500">{summarize(log.data)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
