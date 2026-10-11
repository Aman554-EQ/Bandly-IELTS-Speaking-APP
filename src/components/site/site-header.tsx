import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { HeaderAccount } from "./header-account";
import { MobileNav } from "./mobile-nav";
import { NAV } from "./nav";
import { NavLinks } from "./nav-links";
import { ThemeSwitcher } from "./theme-switcher";

/**
 * Site header. From 1280 px: one row (logo, links, theme, account).
 * Narrower: logo and a menu button that opens every link, the theme and the
 * account area (MobileNav). The active-link highlight needs the URL, so only
 * the parts that read it wait inside Suspense.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b [@media(max-height:520px)]:static border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="relative mx-auto flex w-full max-w-7xl items-center justify-between gap-x-5 px-4 py-2.5 xl:py-3">
        <Logo />
        <nav aria-label="Main" className="hidden gap-1 xl:flex">
          <Suspense
            fallback={NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[15px] font-medium text-muted"
              >
                {n.label}
              </Link>
            ))}
          >
            <NavLinks />
          </Suspense>
        </nav>
        <div className="hidden items-center gap-2 xl:flex">
          <ThemeSwitcher />
          <Suspense fallback={<span className="h-8 w-24" aria-hidden="true" />}>
            <HeaderAccount />
          </Suspense>
        </div>
        <div className="xl:hidden">
          <Suspense
            fallback={
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-line" aria-hidden="true" />
            }
          >
            <MobileNav
              account={
                <Suspense fallback={<span className="block h-12" aria-hidden="true" />}>
                  <HeaderAccount variant="menu" />
                </Suspense>
              }
            />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
