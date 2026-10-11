/**
 * Hero illustration: a still of the exam room (examiner line, the student
 * speaking, and the band report it leads to). Decorative; the real thing is
 * one click away.
 */
const CRITERIA = [
  ["Fluency & Coherence", 7],
  ["Lexical Resource", 7],
  ["Grammar", 6.5],
  ["Pronunciation", 7],
] as const;

export function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(ellipse_at_top_right,var(--primary-soft),transparent_65%)]" />
      <div className="card p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">
            EH
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Emma Hayes</p>
            <p className="text-sm text-muted">IELTS Speaking examiner</p>
          </div>
          <span className="ml-auto rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            Part 1
          </span>
        </div>
        <p className="mt-4 rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3 text-[15px]">
          Let&apos;s talk about your hometown. Where is your hometown?
        </p>
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="text-sm font-medium text-recording">Listening…</span>
          <span className="flex h-8 items-end gap-1">
            {[0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.8].map((h, i) => (
              <span
                key={i}
                className="eq-bar w-1.5 rounded-full bg-primary"
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </span>
        </div>
      </div>

      <div className="card relative -mt-3 ml-8 p-5 shadow-lg sm:ml-14">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Your band</p>
          <p className="font-display text-4xl font-semibold text-primary">7.0</p>
        </div>
        <ul className="mt-3 space-y-2">
          {CRITERIA.map(([name, band]) => (
            <li key={name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
              <span>{name}</span>
              <span className="font-semibold tabular-nums">{band.toFixed(1)}</span>
              <span className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(band / 9) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
