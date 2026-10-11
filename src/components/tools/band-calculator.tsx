"use client";

import { type ReactNode, useId, useState } from "react";
import {
  averageBand,
  BAND_STEPS,
  bandLabel,
  bandRanges,
  formatBand,
  type Module,
  overallBand,
  rawNeededFor,
  rawToBand,
  type ReadingType,
  tableFor,
} from "@/content/band-score";

type Tab = "overall" | "listening" | "reading";
const TABS: { id: Tab; label: string }[] = [
  { id: "overall", label: "Overall Band" },
  { id: "listening", label: "Listening" },
  { id: "reading", label: "Reading" },
];

const MODULES: { id: Module; label: string; color: string; icon: ReactNode }[] = [
  {
    id: "listening",
    label: "Listening",
    color: "#d97706",
    icon: (
      <path d="M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h1v7H5a2 2 0 0 1-2-2v-3Zm18 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z" />
    ),
  },
  {
    id: "reading",
    label: "Reading",
    color: "#2563eb",
    icon: <path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5m0-13C14 5 17 4.5 21 5v13c-4-.5-7 0-9 1.5m0-13v13" />,
  },
  {
    id: "writing",
    label: "Writing",
    color: "#e11d48",
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
        <path d="m9 15 1-3.5 5.5-5.5 2.5 2.5L12.5 14 9 15Z" />
      </>
    ),
  },
  {
    id: "speaking",
    label: "Speaking",
    color: "#0d9488",
    icon: <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0m6 6v3" />,
  },
];

function Icon({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11"
      style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        {children}
      </svg>
    </span>
  );
}

/**
 * Circular gauge: the arc fills band / 9, with a gap at the top like a dial.
 * Inside the ring only the number and a short caption (they must fit the
 * inner circle at every width); the level and the test name sit below it.
 */
function BandRing({ band, caption, name }: { band: number; caption: string; name?: string }) {
  const gid = useId().replace(/:/g, "");
  const r = 84;
  const c = 2 * Math.PI * r;
  const track = c * 0.94; // leave a small gap at the top
  const fill = track * (band / 9);
  return (
    <figure className="mx-auto flex w-full max-w-[230px] flex-col items-center">
      <div className="relative aspect-square w-full" role="img" aria-label={`${name ?? caption}: ${formatBand(band)}`}>
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-[78deg]">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--primary)" />
              <stop offset="100%" stopColor="color-mix(in oklab, var(--primary) 55%, #22d3ee)" />
            </linearGradient>
          </defs>
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${track} ${c}`}
          />
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${fill} ${c}`}
            className="transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>
        {/* The inner circle is ~77% of the ring; keep the text inside 64% of it. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <span className="font-display text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
            {formatBand(band)}
          </span>
          <span className="mt-1 max-w-[64%] text-center text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-muted">
            {caption}
          </span>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-col items-center gap-1 text-center">
        <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
          {bandLabel(band)}
        </span>
        {name && <span className="text-sm text-muted">{name}</span>}
      </figcaption>
    </figure>
  );
}

const selectClass =
  "w-24 shrink-0 sm:w-28 rounded-xl border border-line-strong bg-surface px-3 py-2 text-base font-semibold tabular-nums focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

function OverallTab() {
  const [bands, setBands] = useState<Record<Module, number>>({
    listening: 7,
    reading: 7,
    writing: 6.5,
    speaking: 6.5,
  });
  const values = MODULES.map((m) => bands[m.id]);
  const overall = overallBand(values);
  const avg = averageBand(values);
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
      <div>
        <ul className="space-y-3">
          {MODULES.map((m) => (
            <li key={m.id} className="flex items-center gap-3 sm:gap-4">
              <Icon color={m.color}>{m.icon}</Icon>
              <label htmlFor={`band-${m.id}`} className="min-w-0 flex-1 font-semibold sm:w-24 sm:flex-none">
                {m.label}
              </label>
              <select
                id={`band-${m.id}`}
                className={selectClass}
                value={bands[m.id]}
                onChange={(e) => setBands((b) => ({ ...b, [m.id]: Number(e.target.value) }))}
              >
                {[...BAND_STEPS].reverse().map((s) => (
                  <option key={s} value={s}>
                    {formatBand(s)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-muted" aria-live="polite">
          Average {avg.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} →{" "}
          <strong className="text-ink">{formatBand(overall)}</strong>. Rounded the official way: .25 → next half band,
          .75 → next whole band.
        </p>
      </div>
      <BandRing band={overall} caption="Overall band" />
    </div>
  );
}

function RawTab({ module }: { module: "listening" | "reading" }) {
  const [raw, setRaw] = useState(30);
  const [type, setType] = useState<ReadingType>("academic");
  const [target, setTarget] = useState(7);
  const table = tableFor(module, type);
  const band = rawToBand(raw, table);
  const need = rawNeededFor(target, table);
  const name =
    module === "listening" ? "Listening" : type === "academic" ? "Academic Reading" : "General Training Reading";
  return (
    <div className="space-y-8">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div className="space-y-5">
          {module === "reading" && (
            <div role="radiogroup" aria-label="Reading test" className="inline-flex rounded-xl bg-surface-2 p-1">
              {(["academic", "general"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setType(t)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${type === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {t === "academic" ? "Academic" : "General Training"}
                </button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor={`raw-${module}`} className="font-semibold">
              Correct answers (out of 40)
            </label>
            <div className="mt-2 flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={40}
                value={raw}
                onChange={(e) => setRaw(Number(e.target.value))}
                aria-label={`${name} correct answers`}
                className="h-6 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
              />
              <input
                id={`raw-${module}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={40}
                value={raw}
                onChange={(e) => setRaw(Math.max(0, Math.min(40, Math.floor(Number(e.target.value) || 0))))}
                className="w-20 rounded-xl border border-line-strong bg-surface px-3 py-2 text-center text-base font-semibold tabular-nums"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-4 text-[15px]">
            <label htmlFor={`target-${module}`} className="font-medium">
              Target band
            </label>
            <select
              id={`target-${module}`}
              className={`${selectClass} w-24 py-1.5`}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              {BAND_STEPS.filter((s) => s >= 4).map((s) => (
                <option key={s} value={s}>
                  {formatBand(s)}
                </option>
              ))}
            </select>
            <span aria-live="polite">
              {need === null ? (
                "Not reachable in this table."
              ) : (
                <>
                  needs at least <strong>{need}/40</strong>
                  {raw >= need ? " — you're there." : ` — ${need - raw} more correct.`}
                </>
              )}
            </span>
          </div>
        </div>
        <BandRing
          band={band}
          caption={module === "listening" ? "Listening band" : "Reading band"}
          name={`${name} band`}
        />
      </div>

      <details className="group rounded-xl border border-line">
        <summary className="cursor-pointer px-4 py-3 font-semibold">{name}: full conversion table</summary>
        <div className="grid grid-cols-2 gap-px overflow-hidden border-t border-line bg-line sm:grid-cols-4">
          {bandRanges(table)
            .filter((r) => r.band >= 2.5)
            .map((r) => {
              const here = band === r.band;
              return (
                <div
                  key={r.band}
                  className={`flex items-center justify-between px-4 py-2 text-sm tabular-nums ${here ? "bg-primary-soft font-semibold text-primary" : "bg-surface"}`}
                  aria-current={here ? "true" : undefined}
                >
                  <span>{r.from === r.to ? r.from : `${r.from}–${r.to}`}</span>
                  <span>{formatBand(r.band)}</span>
                </div>
              );
            })}
        </div>
      </details>
    </div>
  );
}

/** Band score calculator: overall band from four modules, and raw → band for Listening and Reading. */
export function BandCalculator() {
  const [tab, setTab] = useState<Tab>("overall");
  return (
    <div>
      <div role="tablist" aria-label="Calculator" className="card grid grid-cols-3 gap-1 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-xl px-2 py-2.5 text-sm font-semibold transition-colors sm:px-3 sm:text-base ${
              tab === t.id ? "bg-ink text-bg shadow" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="card mt-5 rounded-3xl p-4 sm:p-8"
      >
        {tab === "overall" ? <OverallTab /> : <RawTab key={tab} module={tab} />}
      </div>
      <p className="mt-3 text-center text-sm text-muted">
        Based on published IELTS partner guidance — actual test conversions may vary slightly.
      </p>
    </div>
  );
}
