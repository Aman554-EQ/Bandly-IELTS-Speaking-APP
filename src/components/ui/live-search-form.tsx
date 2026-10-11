"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useRef, useTransition } from "react";

const TYPING_DELAY_MS = 300;

/**
 * A GET search/filter form that updates the results while you type: text
 * fields after a short pause, selects immediately, Enter at once. The query
 * goes in the URL (so Back, refresh and sharing keep it), and the page's
 * server component re-renders with it. Empty fields are left out of the URL.
 */
export function LiveSearchForm({
  action,
  className,
  children,
  label,
}: {
  /** The page path the query applies to, e.g. "/admin/tests". */
  action: string;
  className?: string;
  children: ReactNode;
  /** Accessible name of the search region. */
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function go(form: HTMLFormElement) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (typeof v === "string" && v.trim() !== "") params.set(k, v.trim());
    }
    const qs = params.toString();
    if (qs === last.current) return;
    last.current = qs;
    startTransition(() => router.replace(qs ? `${action}?${qs}` : action, { scroll: false }));
  }

  return (
    <form
      action={action}
      role="search"
      aria-label={label}
      aria-busy={pending || undefined}
      className={className}
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        go(e.currentTarget);
      }}
      onChange={(e) => {
        // Selects, checkboxes and radios apply at once; text waits for a pause.
        const t = e.target as HTMLElement;
        if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && /checkbox|radio/.test(t.type))) {
          go(e.currentTarget);
        }
      }}
      onInput={(e) => {
        const t = e.target as HTMLElement;
        if (!(t instanceof HTMLInputElement) || /checkbox|radio/.test(t.type)) return;
        if ((e.nativeEvent as InputEvent).isComposing) return;
        const form = e.currentTarget;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => go(form), TYPING_DELAY_MS);
      }}
    >
      {children}
      <span role="status" className={`self-center text-sm text-muted ${pending ? "" : "sr-only"}`}>
        {pending ? "Searching…" : ""}
      </span>
    </form>
  );
}
