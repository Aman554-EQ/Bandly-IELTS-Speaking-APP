import Link from "next/link";

/** Wordmark: "Bandly" with a small band-score mark. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-ink" aria-label="Bandly home">
      <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="7" className="fill-primary" />
        <rect x="6.5" y="13" width="3" height="6" rx="1.5" className="fill-[var(--primary-ink)]" />
        <rect x="11.5" y="9" width="3" height="10" rx="1.5" className="fill-[var(--primary-ink)]" />
        <rect x="16.5" y="6" width="3" height="13" rx="1.5" className="fill-accent" />
      </svg>
      <span className="font-display text-[23px] font-semibold tracking-tight">Bandly</span>
    </Link>
  );
}
