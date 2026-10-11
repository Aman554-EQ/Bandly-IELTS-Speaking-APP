import type { ReactNode } from "react";

/**
 * "Why Bandly": the four selling points, each with a small, true-to-life
 * demonstration (what actually happens in the app), laid out as a bento grid.
 */

function Card({
  icon,
  title,
  body,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`card flex flex-col overflow-hidden p-6 ${className}`}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
          {icon}
        </svg>
      </span>
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <p className="mt-1.5 text-[15px] text-muted">{body}</p>
      <div className="mt-5 flex-1 rounded-xl bg-surface-2 p-4" aria-hidden="true">
        {children}
      </div>
    </article>
  );
}

function Bubble({ who, children }: { who: "you" | "examiner"; children: ReactNode }) {
  const you = who === "you";
  return (
    <div className={`flex ${you ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
          you ? "rounded-br-sm bg-primary text-primary-ink" : "rounded-bl-sm bg-surface"
        }`}
      >
        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {you ? "You" : "Examiner"}
        </span>
        {children}
      </p>
    </div>
  );
}

export function ValueGrid() {
  return (
    <section className="border-y border-line bg-surface" aria-labelledby="why-h">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Why Bandly</p>
        <h2 id="why-h" className="mt-2 max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything a real examiner does, whenever you want to practice
        </h2>
        <p className="mt-2 max-w-2xl text-muted">
          Not a list of questions on a screen: a spoken exam that reacts to you, keeps real time, and tells you exactly
          how to improve.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-5">
          <Card
            className="lg:col-span-3"
            title="An examiner who listens"
            body="Ask for a repeat, pause to think, or ask what a word means. The examiner understands and responds the way a real one would."
            icon={<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" />}
          >
            <div className="space-y-2.5">
              <Bubble who="examiner">What do you enjoy most about your studies?</Bubble>
              <Bubble who="you">Sorry, could you repeat the question?</Bubble>
              <Bubble who="examiner">I&apos;ll repeat the question. What do you enjoy most about your studies?</Bubble>
              <Bubble who="you">Hmm… I think it&apos;s the practical work, because…</Bubble>
              <p className="pt-1 text-center text-xs text-muted">Pauses to think are fine; the examiner waits.</p>
            </div>
          </Card>

          <Card
            className="lg:col-span-2"
            title="Real exam timing"
            body="Exactly one minute to prepare in Part 2, two minutes to speak, and a polite interruption when time is up."
            icon={
              <>
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2.5 2.5M9 2h6" />
              </>
            }
          >
            <ul className="space-y-4">
              {[
                ["Prepare", "1:00", "60%", "bg-accent"],
                ["Speak", "2:00", "100%", "bg-primary"],
              ].map(([label, time, w, color]) => (
                <li key={label}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{label}</span>
                    <span className="font-mono tabular-nums">{time}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface">
                    <div className={`h-full rounded-full ${color}`} style={{ width: w }} />
                  </div>
                </li>
              ))}
              <li className="rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="font-semibold">At 2:00</span> · “Thank you. That is the end of your time.”
              </li>
            </ul>
          </Card>

          <Card
            className="lg:col-span-2"
            title="Part-by-part scores"
            body="A band for each part and each criterion, with evidence from your own words and stronger versions of your answers."
            icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />}
          >
            <div className="flex items-end justify-between">
              <span className="text-sm font-medium">Part 2 · Long turn</span>
              <span className="font-display text-3xl font-semibold text-primary">6.5</span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <p className="rounded-lg bg-surface px-3 py-2">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">You said</span>
                “It was very good and I liked it very much.”
              </p>
              <p className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-ink">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Stronger version
                </span>
                “It was genuinely moving, and it stayed with me for days.”
              </p>
            </div>
          </Card>

          <Card
            className="lg:col-span-3"
            title="Two British examiners, two styles"
            body="Choose Emma or James. Exam style for real test conditions; Guided style with captions and pauses while you learn."
            icon={
              <>
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["EH", "Emma Hayes", "Female voice"],
                ["JC", "James Carter", "Male voice"],
              ].map(([i, name, voice]) => (
                <div key={name} className="flex items-center gap-3 rounded-xl bg-surface p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-ink">
                    {i}
                  </span>
                  <span>
                    <span className="block font-semibold">{name}</span>
                    <span className="text-sm text-muted">{voice} · British English</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-3 text-sm">
                <span className="font-semibold">Exam style</span>
                <span className="block text-muted">No captions, no pauses, real conditions.</span>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3 text-sm">
                <span className="font-semibold">Guided style</span>
                <span className="block text-muted">Captions, pause button and time reminders.</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
