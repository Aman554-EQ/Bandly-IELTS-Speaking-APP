import { HeroPreview } from "@/components/home/hero-preview";
import { TestChooser } from "@/components/home/test-chooser";
import { ValueGrid } from "@/components/home/value-grid";
import { SiteFooter } from "@/components/site/site-footer";
import { ButtonLink } from "@/components/ui/button";
import { YouTubeVideo } from "@/components/ui/youtube-video";
import { PRACTICE_VIDEO } from "@/content/videos";

const FACTS = ["3 parts · 11–14 minutes", "British examiner voices", "A band for every criterion"];

const GUIDE_POINTS = [
  ["How each part works", "Timing, question types and what a strong answer sounds like."],
  ["What the examiner does", "Repeats, follow-ups, interruptions, and what you can ask."],
  ["How your band is calculated", "Four criteria, part scores and official rounding."],
];

export default function Home() {
  return (
    <>
      <main>
        {/* Hero */}
        <section className="overflow-hidden border-b border-line bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">IELTS Speaking practice</p>
              <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                Practice with an examiner who runs the test just like the real exam.
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-muted sm:text-xl">
                Same structure, same timing, same examiner wording. Speak naturally, and get an estimated band score
                with detailed feedback for every part.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/practice?part=full" size="xl" className="group">
                  Take the full test
                  <span
                    className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </ButtonLink>
                <ButtonLink href="#choose" variant="secondary" size="xl">
                  Choose a part
                </ButtonLink>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                {FACTS.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-success" aria-hidden="true">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        <TestChooser />

        <ValueGrid />

        {/* New to the test: guide + video */}
        <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="guide-h">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Test guide</p>
              <h2 id="guide-h" className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                New to the IELTS Speaking test?
              </h2>
              <p className="mt-3 text-lg text-muted">
                Read how each part works, what the examiner does, and how your band is calculated, or watch the video to
                see how to practice from home.
              </p>
              <ul className="mt-6 space-y-4">
                {GUIDE_POINTS.map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block font-semibold">{t}</span>
                      <span className="text-[15px] text-muted">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/guide" size="lg">
                  Read the test guide
                </ButtonLink>
                <ButtonLink href="/band-calculator" variant="secondary" size="lg">
                  Band calculator
                </ButtonLink>
              </div>
            </div>
            <YouTubeVideo id={PRACTICE_VIDEO.id} title={PRACTICE_VIDEO.title} caption={PRACTICE_VIDEO.caption} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
