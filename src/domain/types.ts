import type { Actor } from './audit';

/** 所有社區範圍的操作都帶著這個：communityId 一律來自權限檢查，不信任使用者輸入 */
export type Scope = {
  communityId: string;
  actor: Actor;
};

/** 可以直接顯示給使用者看的錯誤 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
