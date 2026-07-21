/** Compact table-tennis racket glyph for serve indicator. */
export function TableTennisRacketIcon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      data-testid="serve-racket"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse
        cx="10"
        cy="9"
        rx="6.5"
        ry="7"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <ellipse cx="10" cy="9" rx="3" ry="3.2" fill="currentColor" opacity="0.35" />
      <path
        d="M14.5 14.5 L20.5 21"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
