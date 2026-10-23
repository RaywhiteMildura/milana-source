/** The RaceLens mark: green rounded square, gold ring, white centre. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#f3c75a" strokeWidth="6" />
      <circle cx="32" cy="32" r="5" fill="#fff" />
    </svg>
  );
}
