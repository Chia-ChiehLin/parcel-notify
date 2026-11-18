'use client';

import { Button } from './ui';

export function PrintButton({ label = '列印' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
