import { examinerById, type ExaminerId } from "./examiners";
import { allScriptClips, formatLineFor, greetingFor, line } from "./script";
import type { Blueprint, Clip, CueCard, ExamContent, ExamMode, Fidelity, Part, Step } from "./types";

/**
 * Compiles a mode + fidelity + content into an ordered list of steps
 * (plan-2 §4.8). The blueprint is static; dynamic behaviour (repeats, probes,
 * skipping questions when time runs short) is decided by the runtime and the
 * scheduler while the exam runs.
 */

export interface CompileOptions {
  mode: ExamMode;
  fidelity: Fidelity;
  content: ExamContent;
  /** Student's local hour (0–23), used for "Good morning/afternoon/evening". */
  localHour: number;
  /** Examiner persona (voice). Defaults to Emma. */
  examiner?: ExaminerId;
}

// --- Clip keys for content lines (stable, so audio can be pre-rendered) -----

export const contentClips = {
  p1TopicIntro: (topicId: string, text: string): Clip => ({ key: `c.p1.${topicId}.intro`, text }),
  p1Question: (qid: string, text: string): Clip => ({ key: `c.p1.${qid}`, text }),
  p2Prompt: (card: CueCard): Clip => ({ key: `c.p2.${card.id}.prompt`, text: card.spokenPrompt }),
  p2RoundOff: (id: string, text: string): Clip => ({ key: `c.p2.${id}`, text }),
  p3Intro: (card: CueCard): Clip => ({ key: `c.p3.${card.id}.intro`, text: card.part3Intro }),
  p3OnlyIntro: (card: CueCard): Clip => ({ key: `c.p3.${card.id}.only_intro`, text: card.part3OnlyIntro }),
  p3SubtopicIntro: (subId: string, text: string): Clip => ({ key: `c.p3.${subId}.intro`, text }),
  p3Question: (qid: string, text: string): Clip => ({ key: `c.p3.${qid}`, text }),
  p3Rephrase: (qid: string, text: string): Clip => ({ key: `c.p3.${qid}.rephrase`, text }),
  p3FollowUp: (qid: string, i: number, text: string): Clip => ({ key: `c.p3.${qid}.fu${i + 1}`, text }),
};

export function partsForMode(mode: ExamMode): Part[] {
  switch (mode) {
    case "part1":
      return [1];
    case "part2":
      return [2];
    case "part3":
      return [3];
    case "full":
      return [1, 2, 3];
  }
}

function part1Steps(content: ExamContent): Step[] {
  const steps: Step[] = [
    { kind: "part_start", part: 1 },
    { kind: "say", clip: line("p1.intro"), part: 1 },
  ];
  for (const topic of content.part1) {
    steps.push({
      kind: "group_intro",
      part: 1,
      group: topic.id,
      clip: contentClips.p1TopicIntro(topic.id, topic.intro),
    });
    for (const q of topic.questions) {
      steps.push({
        kind: "ask",
        part: 1,
        group: topic.id,
        questionId: q.id,
        clip: contentClips.p1Question(q.id, q.text),
        policy: "p1",
        allowWhyProbe: q.allowWhyProbe ?? false,
      });
    }
  }
  steps.push({ kind: "part_end", part: 1 });
  return steps;
}

function part2Steps(card: CueCard): Step[] {
  const steps: Step[] = [
    { kind: "part_start", part: 2 },
    { kind: "say", clip: line("p2.intro"), part: 2 },
    { kind: "cuecard_show" },
    { kind: "say", clip: contentClips.p2Prompt(card), part: 2 },
    { kind: "prep" },
    { kind: "long_turn" },
  ];
  card.roundOff.slice(0, 2).forEach((r, index) => {
    steps.push({ kind: "round_off", index, questionId: r.id, clip: contentClips.p2RoundOff(r.id, r.text) });
  });
  steps.push(
    { kind: "say", clip: line("p2.notes.away"), part: 2 },
    { kind: "cuecard_hide" },
    { kind: "part_end", part: 2 },
  );
  return steps;
}

function part3Steps(card: CueCard, standalone: boolean): Step[] {
  const steps: Step[] = [
    { kind: "part_start", part: 3 },
    { kind: "say", clip: standalone ? contentClips.p3OnlyIntro(card) : contentClips.p3Intro(card), part: 3 },
  ];
  for (const sub of card.part3) {
    steps.push({
      kind: "group_intro",
      part: 3,
      group: sub.id,
      clip: contentClips.p3SubtopicIntro(sub.id, sub.intro),
    });
    for (const q of sub.questions) {
      steps.push({
        kind: "ask",
        part: 3,
        group: sub.id,
        questionId: q.id,
        clip: contentClips.p3Question(q.id, q.text),
        policy: "p3",
        rephrase: q.rephrase ? contentClips.p3Rephrase(q.id, q.rephrase) : undefined,
        followUps: (q.followUps ?? []).map((f, i) => contentClips.p3FollowUp(q.id, i, f)),
      });
    }
  }
  steps.push({ kind: "part_end", part: 3 });
  return steps;
}

export function compileBlueprint(opts: CompileOptions): Blueprint {
  const { mode, fidelity, content, localHour } = opts;
  const examiner = examinerById(opts.examiner);
  const full = mode === "full";
  const steps: Step[] = [
    { kind: "say", clip: greetingFor(localHour, examiner.name) },
    { kind: "say", clip: line("open.purpose") },
    { kind: "ask_name", clip: line("open.name") },
    { kind: "say", clip: formatLineFor(mode) },
    { kind: "say", clip: line("open.begin") },
  ];

  if (mode === "part1" || full) {
    steps.push(...part1Steps(content));
    if (full) steps.push({ kind: "say", clip: line("p1.end"), part: 1 });
  }
  if (mode === "part2" || full) {
    steps.push(...part2Steps(content.cueCard));
    if (full) steps.push({ kind: "say", clip: line("p2.end"), part: 2 });
  }
  if (mode === "part3" || full) {
    steps.push(...part3Steps(content.cueCard, !full));
    if (full) steps.push({ kind: "say", clip: line("p3.end"), part: 3 });
  }

  steps.push({ kind: "close", clip: full ? line("close.full") : line("close.part") });

  return {
    version: 1,
    mode,
    fidelity,
    examiner: { id: examiner.id, name: examiner.name },
    steps,
    clips: uniqueClips([...stepClips(steps), ...allScriptClips(examiner.name)]),
    cueCard: mode === "part2" || full ? content.cueCard : mode === "part3" ? content.cueCard : null,
  };
}

function stepClips(steps: Step[]): Clip[] {
  const out: Clip[] = [];
  for (const s of steps) {
    if ("clip" in s) out.push(s.clip);
    if (s.kind === "ask") {
      if (s.rephrase) out.push(s.rephrase);
      if (s.followUps) out.push(...s.followUps);
    }
  }
  return out;
}

function uniqueClips(clips: Clip[]): Clip[] {
  const seen = new Map<string, Clip>();
  for (const c of clips) if (!seen.has(c.key)) seen.set(c.key, c);
  return [...seen.values()];
}

/** Every content clip in a question set, for the voice renderer. */
export function allContentClips(content: ExamContent): Clip[] {
  const modes: ExamMode[] = ["full", "part3"];
  return uniqueClips(
    modes.flatMap((mode) => stepClips(compileBlueprint({ mode, fidelity: "exam", content, localHour: 9 }).steps)),
  ).filter((c) => c.key.startsWith("c."));
}
