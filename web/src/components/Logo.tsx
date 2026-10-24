// OddsBlitzer's mark: a lightning bolt in a ring, drawn in currentColor so it
// takes the brand color in both themes. Same drawing as public/favicon.svg.
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" />
      <path d="M18.5 5.5 L9.5 17.5 H15.5 L13.5 26.5 L22.5 14.5 H16.5 Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
