export function BrmLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="18" width="6" height="10" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="13" y="11" width="6" height="17" rx="1.5" fill="currentColor" opacity="0.75" />
      <rect x="22" y="4" width="6" height="24" rx="1.5" fill="currentColor" />
    </svg>
  );
}
