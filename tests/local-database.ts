import type { Client } from 'pg';

/** Validate the resolved client host as well as the server's actual database name before resetting schemas. */
export async function requireLocalTestDatabase(client: Client, expected: 'parcel_test' | 'parcel_e2e') {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(client.host) || client.host.startsWith('/');
  const { rows: [row] } = await client.query<{ name: string }>('select current_database() as name');
  if (!local || row.name !== expected) throw new Error(`測試只允許清除本機專用資料庫 ${expected}`);
}
