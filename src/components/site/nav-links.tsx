"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

export function NavLinks() {
  const path = usePathname();
  return NAV.map((n) => {
    const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[15px] font-medium transition-colors ${
          active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-ink"
        }`}
      >
        {n.label}
      </Link>
    );
  });
}
