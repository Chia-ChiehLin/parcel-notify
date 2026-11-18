import { getResident } from './residents';
import { parseResidentToken } from './tokens';

/** 驗證住戶連結：簽章正確、版本相符、住戶仍在使用中 */
export async function residentFromToken(token: string) {
  const parsed = parseResidentToken(decodeURIComponent(token));
  if (!parsed) return null;
  const r = await getResident(parsed.residentId);
  if (!r || r.resident.status !== 'active' || r.resident.tokenVersion !== parsed.version) return null;
  return r;
}
