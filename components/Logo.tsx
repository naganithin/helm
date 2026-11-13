import Link from "next/link";

/** The Helm mark: a ship's wheel (steering through risk), hub in the accent colour. Follows the active theme. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logomark">
      <rect width="32" height="32" rx="9" fill="var(--logo-bg)" />
      <g stroke="var(--logo-fg)" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <circle cx="16" cy="16" r="7" />
        {spokes.map((a) => <line key={a} x1={16 + Math.cos(a) * 3.2} y1={16 + Math.sin(a) * 3.2} x2={16 + Math.cos(a) * 11.6} y2={16 + Math.sin(a) * 11.6} />)}
      </g>
      <circle cx="16" cy="16" r="2.6" fill="var(--acc)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="brand" aria-label="Helm home">
      <LogoMark />
      <span>Helm</span>
    </Link>
  );
}