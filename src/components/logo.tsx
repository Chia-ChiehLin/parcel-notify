export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#0f766e" />
      <path d="M20 8 31 14v12L20 32 9 26V14z" fill="#ccfbf1" />
      <path d="M20 8 31 14 20 20 9 14z" fill="#fff" />
      <path d="M20 20v12" stroke="#0f766e" strokeWidth="2" />
      <path d="m14.5 11 11 6" stroke="#0f766e" strokeWidth="2" />
    </svg>
  );
}
