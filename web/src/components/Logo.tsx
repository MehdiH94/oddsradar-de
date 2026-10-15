// CoteRadar's mark: a radar sweep over two rings, drawn in currentColor so it
// takes the brand color in both themes. Same drawing as public/favicon.svg.
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="2" opacity="0.55" />
      <path d="M16 16 L16 3 A13 13 0 0 1 27.3 9.5 Z" fill="currentColor" opacity="0.35" />
      <path d="M16 16 L27.3 9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="21.5" cy="11.5" r="2" fill="currentColor" />
    </svg>
  );
}
