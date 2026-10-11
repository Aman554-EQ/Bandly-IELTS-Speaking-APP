import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CopyrightYear } from "./copyright-year";
import { NewsletterForm } from "./newsletter-form";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Practice",
    links: [
      { href: "/practice?part=full", label: "Full test" },
      { href: "/practice?part=part1", label: "Part 1" },
      { href: "/practice?part=part2", label: "Part 2" },
      { href: "/practice?part=part3", label: "Part 3" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/library", label: "Library" },
      { href: "/library/makkar-cue-cards", label: "Cue cards" },
      { href: "/band-calculator", label: "Band calculator" },
      { href: "/resources", label: "Resources" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/results", label: "My results" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/profile", label: "Profile" },
      { href: "/guide", label: "Test guide" },
    ],
  },
];

const linkClass = "inline-block py-1 text-muted transition-colors hover:text-primary";

/**
 * One compact site footer: brand, pitch, newsletter and disclaimer on the left,
 * three link columns on the right, and a single copyright/legal line below.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface text-sm">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-12">
          <div className="max-w-md">
            <Logo />
            <p className="mt-2 text-muted">
              IELTS Speaking practice with an examiner who listens, keeps real exam timing, and scores every part.
            </p>
            <p className="mt-5 font-semibold text-ink">Stay updated</p>
            <p className="mt-0.5 text-muted">New tests, cue cards and speaking tips in your inbox.</p>
            <div className="mt-2.5">
              <NewsletterForm />
            </div>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-3 gap-3 [overflow-wrap:anywhere] sm:gap-4 md:justify-items-end"
          >
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink">{c.title}</p>
                <ul className="mt-2 space-y-0.5">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className={linkClass}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-line pt-5 text-xs text-muted sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p>
              © <CopyrightYear /> Bandly · Built by{" "}
              <a
                href="https://github.com/Aman554-EQ"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ink hover:underline"
              >
                Aman554-EQ
              </a>
            </p>
            <p className="max-w-xl">
              Estimated scores for practice only. Not affiliated with IELTS, the British Council, IDP or Cambridge.
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
            <li>
              <Link href="/privacy" className={linkClass}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/terms" className={linkClass}>
                Terms of use
              </Link>
            </li>
            <li>
              <Link href="/guide" className={linkClass}>
                How scoring works
              </Link>
            </li>
            <li>
              <a href="https://github.com/Aman554-EQ" target="_blank" rel="noopener noreferrer" className={linkClass}>
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
