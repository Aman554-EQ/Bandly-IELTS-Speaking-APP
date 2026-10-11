import Link from "next/link";

/**
 * "Choose your test": a timeline of the real Speaking test (each part is a
 * link) and one card per part, with what happens in it. Whole cards are links.
 */
const PARTS = [
  {
    mode: "part1",
    n: "1",
    title: "Interview",
    time: "4–5 min",
    minutes: 4.5,
    tint: "#d97706",
    body: "Questions about you, your work or studies, and everyday topics.",
    steps: ["Your name and introduction", "2–3 familiar topics", "Short, natural answers"],
  },
  {
    mode: "part2",
    n: "2",
    title: "Long turn",
    time: "3–4 min",
    minutes: 3.5,
    tint: "#2563eb",
    body: "A cue card, one minute to prepare, then up to two minutes on your own.",
    steps: ["1 minute to make notes", "Speak for 1–2 minutes", "1–2 follow-up questions"],
  },
  {
    mode: "part3",
    n: "3",
    title: "Discussion",
    time: "4–5 min",
    minutes: 4.5,
    tint: "#0d9488",
    body: "Deeper, more abstract questions linked to the Part 2 topic.",
    steps: ["Opinions and reasons", "Compare and predict", "Follow-up probes"],
  },
] as const;

function Arrow() {
  return (
    <span
      className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
      aria-hidden="true"
    >
      →
    </span>
  );
}

export function TestChooser() {
  const total = PARTS.reduce((n, p) => n + p.minutes, 0);
  return (
    <section id="choose" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16" aria-labelledby="choose-h">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Choose your test</p>
          <h2 id="choose-h" className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            One part at a time, or the whole exam
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            The real test runs Part 1 → Part 2 → Part 3 in about 11–14 minutes. Focus on one part, or rehearse all three
            in order.
          </p>
        </div>
      </div>

      {/* Timeline of the real test: each segment is proportional to its length. */}
      <nav aria-label="The Speaking test, part by part" className="mt-8">
        <ol className="flex gap-1.5">
          {PARTS.map((p) => (
            <li key={p.mode} style={{ flexGrow: p.minutes }} className="min-w-0 basis-0">
              <Link
                href={`/practice?part=${p.mode}`}
                className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className="block h-2.5 rounded-full opacity-80 transition-opacity group-hover:opacity-100"
                  style={{ background: p.tint }}
                />
                <span className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold group-hover:underline">Part {p.n}</span>
                  <span className="text-muted">{p.time}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="sr-only">Total about {Math.round(total)} minutes.</p>
      </nav>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map((p) => (
          <Link
            key={p.mode}
            href={`/practice?part=${p.mode}`}
            className="card group relative flex flex-col overflow-hidden p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-1 hover:border-line-strong hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <span className="absolute inset-x-0 top-0 h-1" style={{ background: p.tint }} aria-hidden="true" />
            <span className="flex items-start justify-between gap-3">
              <span
                className="grid h-12 w-12 place-items-center rounded-2xl font-display text-2xl font-semibold"
                style={{ color: p.tint, background: `color-mix(in oklab, ${p.tint} 14%, transparent)` }}
                aria-hidden="true"
              >
                {p.n}
              </span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-muted">{p.time}</span>
            </span>
            <span className="mt-4 text-xl font-semibold">
              Part {p.n} <span className="font-normal text-muted">· {p.title}</span>
            </span>
            <span className="mt-1.5 text-[15px] text-muted">{p.body}</span>
            <ul className="mt-4 flex-1 space-y-1.5 text-sm">
              {p.steps.map((s) => (
                <li key={s} className="flex gap-2">
                  <span style={{ color: p.tint }} aria-hidden="true">
                    •
                  </span>
                  {s}
                </li>
              ))}
            </ul>
            <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-primary">
              Practice Part {p.n} <Arrow />
            </span>
          </Link>
        ))}

        {/* The full test: the realistic option, highlighted. */}
        <Link
          href="/practice?part=full"
          className="group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-primary p-6 text-primary-ink shadow-md transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="flex h-12 items-center gap-1" aria-hidden="true">
              {PARTS.map((p) => (
                <span
                  key={p.mode}
                  className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 font-display text-lg font-semibold"
                >
                  {p.n}
                </span>
              ))}
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 font-mono text-xs">11–15 min</span>
          </span>
          <span className="mt-4 text-xl font-semibold">
            Full test <span className="font-normal opacity-80">· most realistic</span>
          </span>
          <span className="mt-1.5 text-[15px] opacity-90">
            All three parts in order, with real timing and transitions, exactly like exam day.
          </span>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm opacity-95">
            {["Same order and timing", "Scored part by part", "One overall band"].map((s) => (
              <li key={s} className="flex gap-2">
                <span aria-hidden="true">✓</span>
                {s}
              </li>
            ))}
          </ul>
          <span className="mt-5 inline-flex items-center gap-1.5 font-semibold">
            Take the full test <Arrow />
          </span>
        </Link>
      </div>
    </section>
  );
}
