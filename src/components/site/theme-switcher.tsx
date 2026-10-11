"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "white" | "dark";

const THEMES: { id: Theme; label: string; icon: React.ReactNode }[] = [
  {
    id: "light",
    label: "Soft",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" opacity="0" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    id: "white",
    label: "White",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    ),
  },
];

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => (document.documentElement.dataset.theme as Theme) ?? "light";
const getServerTheme = () => null;

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("bandly-theme", t);
  } catch {
    /* private mode */
  }
}

/** Three-way theme switch: Soft · White · Dark. */
export function ThemeSwitcher({ labels = "wide" }: { labels?: "wide" | "always" } = {}) {
  const current = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  return (
    <div
      role="group"
      aria-label="Colour theme"
      className={`inline-flex rounded-xl border border-line bg-surface-2 p-1 ${labels === "always" ? "w-full" : ""}`}
    >
      {THEMES.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            title={`${t.label} theme`}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${labels === "always" ? "h-10 flex-1" : "h-8"} ${
              active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
            }`}
          >
            {t.icon}
            <span className={labels === "always" ? "" : "sr-only 2xl:not-sr-only"}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
