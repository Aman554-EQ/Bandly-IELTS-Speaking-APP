import type { Metadata } from "next";
import Link from "next/link";
import { BandCalculator } from "@/components/tools/band-calculator";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "IELTS band score calculator",
  description:
    "Work out your overall IELTS band from Listening, Reading, Writing and Speaking, and convert Listening and Reading raw scores to bands.",
};

const FAQ = [
  [
    "Is the overall band an average?",
    "Yes. Add the four module bands, divide by four, and round to the nearest half band. Exact quarters round up: 6.25 becomes 6.5, and 6.75 becomes 7.0.",
  ],
  [
    "Why does General Training Reading need more correct answers?",
    "Its passages are less complex than Academic ones, so the same band needs a higher raw score: 30/40 is about 7.0 in Academic but 6.0 in General Training.",
  ],
  [
    "Is half a mark possible in Listening or Reading?",
    "No. Each question is worth one mark, with no negative marking, so always answer every question.",
  ],
  [
    "Are these tables official?",
    "They follow the conversion guidance published by IELTS partners and the Cambridge books. Each real test is calibrated, so a band may need one mark more or less.",
  ],
];

export default function BandCalculatorPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Free tool</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">IELTS band score calculator</h1>
      <p className="mt-3 max-w-3xl text-lg text-muted">
        Choose your band in each module to see your overall score, or convert a Listening or Reading raw score (out of
        40) to a band.
      </p>

      <div className="mt-8">
        <BandCalculator />
      </div>

      <section className="mt-14">
        <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          <span className="h-px w-8 bg-primary" aria-hidden="true" />
          How scoring works
        </p>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">
          How IELTS band scores are calculated
        </h2>
        <div className="mt-5 space-y-4 text-[17px] leading-relaxed">
          <p>
            <strong>Listening and Reading</strong> are marked out of 40 raw points — one point per correct answer, with
            no negative marking. Your raw score is then converted to a band using a calibration table. General Training
            Reading needs more correct answers than Academic for the same band, because its passages are less complex.
          </p>
          <p>
            <strong>Writing and Speaking</strong> are assessed by examiners against four criteria each, producing a band
            from 0–9 in half-band steps. Speaking is marked on Fluency and Coherence, Lexical Resource, Grammatical
            Range and Accuracy, and Pronunciation.
          </p>
          <p>
            <strong>Your overall band</strong> is the mean of the four module bands, rounded to the nearest half band —
            and IELTS rounds <em>up</em>: an average of 6.25 becomes 6.5, and 6.75 becomes 7.0.
          </p>
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        {FAQ.map(([q, a]) => (
          <div key={q} className="card p-6">
            <h3 className="font-semibold">{q}</h3>
            <p className="mt-2 text-[15px] text-muted">{a}</p>
          </div>
        ))}
      </section>

      <section className="card mt-12 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Not sure what your Speaking band is?</h2>
          <p className="mt-1 text-muted">
            Take a real-format Speaking test with an examiner that listens, and get a band for each criterion.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/practice?part=full">Take the full test</ButtonLink>
          <ButtonLink href="/resources" variant="secondary">
            IELTS resources
          </ButtonLink>
        </div>
      </section>
      <p className="mt-6 text-sm text-muted">
        See also the{" "}
        <Link href="/guide" className="text-primary underline">
          Speaking test guide
        </Link>
        .
      </p>
    </main>
  );
}
