import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { YouTubeVideo } from "@/components/ui/youtube-video";
import { PRACTICE_VIDEO } from "@/content/videos";

export const metadata: Metadata = {
  title: "Test guide",
  description: "How the IELTS Speaking test works, how the Bandly examiner behaves and how your band is calculated.",
};

const PARTS = [
  {
    title: "Part 1 · Interview",
    time: "4–5 minutes",
    points: [
      "The examiner introduces themselves and asks your name.",
      "Questions about you (work or studies) and two or three familiar topics.",
      "Aim for natural answers of 2–4 sentences with a reason or example.",
      "Short answers may be followed by “Why?” or “Why not?”.",
      "Long answers are politely stopped after about 40 seconds.",
    ],
  },
  {
    title: "Part 2 · Long turn",
    time: "3–4 minutes",
    points: [
      "You get a topic card with points to cover.",
      "Exactly one minute to prepare. You can make notes.",
      "Speak for one to two minutes. The examiner stops you at two minutes.",
      "If you stop before one minute, the examiner asks “Can you tell me anything more?”.",
      "One or two short follow-up questions at the end.",
    ],
  },
  {
    title: "Part 3 · Discussion",
    time: "4–5 minutes",
    points: [
      "Broader, more abstract questions linked to the Part 2 topic.",
      "Give opinions, reasons, examples and comparisons.",
      "The examiner may rephrase a question or ask a follow-up.",
      "Answers are stopped after about 75 seconds.",
    ],
  },
];

const BEHAVIOUR = [
  [
    "You ask “Could you repeat that?”",
    "The examiner repeats the question (Part 3: rephrases it). Exam style: up to 2 repeats per question.",
  ],
  ["You ask what a word means", "Part 1: “I’m afraid I can’t explain that.” Part 3: the question is rephrased."],
  ["You pause mid-sentence to think", "The examiner waits and keeps listening; your answer continues."],
  ["You say “I don’t know”", "Part 1: “That’s all right.” and the next question. Part 3: a simpler wording first."],
  ["You ask “What about you?”", "The examiner politely declines and repeats the question."],
  ["You go off-topic", "The examiner asks the question again once."],
  ["You stay silent", "The question is repeated once, then the examiner moves on."],
  ["You say you want to stop", "The examiner explains how to end the test and continues."],
];

export default function GuidePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Test guide</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">How the Speaking test works</h1>
      <p className="mt-3 max-w-3xl text-lg text-muted">
        The real test lasts 11–14 minutes and has three parts. Bandly follows the same structure, timing and examiner
        wording, and the examiner listens to what you say and responds to it.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {PARTS.map((p) => (
          <section key={p.title} className="card p-6">
            <h2 className="text-xl font-semibold">{p.title}</h2>
            <p className="font-mono text-sm text-muted">{p.time}</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px]">
              {p.points.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="font-display text-3xl font-semibold">How the examiner responds to you</h2>
        <div className="card mt-5 overflow-hidden">
          <table className="w-full text-left text-[15px]">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-5 py-3 font-semibold">When you…</th>
                <th className="px-5 py-3 font-semibold">The examiner…</th>
              </tr>
            </thead>
            <tbody>
              {BEHAVIOUR.map(([a, b]) => (
                <tr key={a} className="border-t border-line">
                  <td className="px-5 py-3 font-medium">{a}</td>
                  <td className="px-5 py-3">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-3xl font-semibold">How your band is calculated</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-lg font-semibold">Four criteria</h3>
            <p className="mt-2 text-[15px]">
              Fluency &amp; Coherence, Lexical Resource, Grammatical Range &amp; Accuracy and Pronunciation are each
              given a whole band from 0 to 9, with evidence quoted from your answers. Pronunciation is estimated from
              how clearly your speech was transcribed, your speed and your pauses.
            </p>
          </div>
          <div className="card p-6">
            <h3 className="text-lg font-semibold">Parts and overall band</h3>
            <p className="mt-2 text-[15px]">
              Each part is scored on its own. In the full test the parts are combined (Part 3 counts most) and the
              overall band is the average of the four criteria with official IELTS rounding (.25 rounds up to .5, .75
              rounds up to the next band).
            </p>
          </div>
          <div className="card p-6 md:col-span-2">
            <h3 className="text-lg font-semibold">Fair-play rules</h3>
            <p className="mt-2 text-[15px]">
              Per part you can ask for 2 repeats, 1 explanation and 1 off-task question, and leave 2 questions
              unanswered, with no effect on your score. Beyond that, Fluency &amp; Coherence (needing prompting) or
              Lexical Resource (too little evidence) is lowered by one band. The report shows exactly what happened and
              why.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="video-h">
        <h2 id="video-h" className="font-display text-3xl font-semibold">
          Watch: practicing IELTS from home
        </h2>
        <p className="mt-2 max-w-3xl text-muted">
          A short tutorial on setting up IELTS practice with a phone or laptop. Plays here when you press play.
        </p>
        <div className="mt-5 max-w-3xl">
          <YouTubeVideo id={PRACTICE_VIDEO.id} title={PRACTICE_VIDEO.title} caption={PRACTICE_VIDEO.caption} />
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink href="/practice?part=full" size="lg">
          Take the full test
        </ButtonLink>
        <ButtonLink href="/practice" variant="secondary" size="lg">
          Practice one part
        </ButtonLink>
      </div>
    </main>
  );
}
