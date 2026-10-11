import { DEFAULT_EXAMINER, EXAMINERS } from "./examiners";
import type { Clip, ExamMode } from "./types";

/**
 * The examiner's fixed lines (plan-2 §4.3).
 *
 * Rules for every line: formal, polite, calm, neutral. Short sentences. No
 * small talk, no praise, no feedback during the test.
 *
 * Every line is pre-rendered once per examiner voice into
 * `public/voice/<examiner>/`. If a line's text changes, its clip is
 * re-rendered; until then the browser voice speaks it instead.
 */

/** Kept for backwards compatibility: the default examiner's name. */
export const EXAMINER_NAME = EXAMINERS[DEFAULT_EXAMINER].name;

function buildLines(examinerName: string) {
  return {
    // Opening
    "open.greet.morning": `Good morning. My name is ${examinerName}, and I will be your examiner today.`,
    "open.greet.afternoon": `Good afternoon. My name is ${examinerName}, and I will be your examiner today.`,
    "open.greet.evening": `Good evening. My name is ${examinerName}, and I will be your examiner today.`,
    "open.purpose": "This is a practice IELTS Speaking test. It is recorded so that your performance can be assessed.",
    "open.name": "Can you tell me your full name, please?",
    "open.format.full":
      "The Speaking test has three parts and lasts between eleven and fourteen minutes. " +
      "In Part 1, I will ask you some questions about yourself and about familiar topics. " +
      "In Part 2, I will give you a topic. You will have one minute to prepare, and then you will speak about it for one to two minutes. " +
      "In Part 3, we will discuss some more general questions connected to that topic. " +
      "Please answer each question as fully as you can.",
    "open.format.part1":
      "Today you will practice Part 1 of the Speaking test. This part lasts four to five minutes. " +
      "I will ask you some questions about yourself and about familiar, everyday topics. " +
      "Please answer naturally and give some detail.",
    "open.format.part2":
      "Today you will practice Part 2 of the Speaking test. This part lasts three to four minutes. " +
      "I will give you a topic. You will have one minute to prepare, and you may make notes. " +
      "Then you will speak about the topic for one to two minutes. I will stop you when the time is up.",
    "open.format.part3":
      "Today you will practice Part 3 of the Speaking test. This part lasts four to five minutes. " +
      "We will discuss some general questions. Please give your opinions and explain your reasons as fully as you can.",
    "open.begin": "Let's begin.",

    // Shared
    "ack.thanks": "Thank you.",
    "ack.ofcourse": "Of course.",
    "resume.continue": "Let's continue from where we stopped.",

    // Handling what the candidate says (live listening)
    "repeat.limit": "I'm afraid I can't repeat the question again. Please answer as best you can.",
    "clarify.p1": "I'm afraid I can't explain that. Please answer the question as best you can.",
    "deflect.opinion": "I'm afraid I can't give my own opinion in the test. Let's go back to the question.",
    "meta.continue": "Please answer the question as fully as you can.",
    "stop.info": "If you would like to finish the test, please select End test. Otherwise, let's continue.",
    "reask.lead": "Let me ask you the question again.",
    "skip.ok": "That's all right.",
    "guide.takeyourtime": "Take your time.",

    // Part 1
    "p1.intro": "In this first part, I'd like to ask you some questions about yourself.",
    "p1.why": "Why?",
    "p1.whynot": "Why not?",
    "p1.repeat": "I'll repeat the question.",
    "p1.moveon": "That's all right. Let's move on.",
    "p1.end": "Thank you. That is the end of Part 1.",

    // Part 2
    "p2.intro":
      "Now, I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. " +
      "Before you talk, you'll have one minute to think about what you are going to say. " +
      "You can make some notes if you wish, using a pen and paper or the notes box on your screen. " +
      "Here is your topic.",
    "p2.prep.start": "You have one minute to prepare. Your time starts now.",
    "p2.prep.10s": "You have ten seconds left.",
    "p2.prep.end":
      "Your preparation time is over. Remember, you have one to two minutes for this, so don't worry if I stop you. " +
      "I'll tell you when the time is up. Can you start speaking now, please?",
    "p2.nudge": "Can you start speaking now, please?",
    "p2.cardinfo": "Your topic is on the card in front of you. Please start speaking now.",
    "p2.more": "Can you tell me anything more about that?",
    "p2.timeup": "Thank you. That is the end of your time.",
    "p2.notes.away": "Thank you. You can put your notes away now.",
    "p2.end": "That is the end of Part 2.",

    // Part 3
    "p3.rephrase": "Let me put that another way.",
    "p3.end": "Thank you. That is the end of Part 3.",
    "probe.why": "Why do you think that is?",
    "probe.example": "Can you give me an example?",
    "probe.more": "Could you tell me a bit more about that?",
    "probe.compare": "How is that different from the past?",
    "probe.future": "Do you think that will change in the future?",
    "probe.agree": "Do you think everyone would agree with that?",

    // Closing
    "close.full":
      "Thank you. That is the end of the Speaking test. Your responses will now be assessed, " +
      "and your estimated band score with detailed feedback will be ready in a few moments. Goodbye.",
    "close.part":
      "Thank you. That is the end of this practice test. Your responses will now be assessed, " +
      "and your estimated band score with feedback will be ready shortly. Goodbye.",
    "close.early": "The test has now ended. Your answers so far will be assessed where possible.",
  } as const;
}

type Lines = ReturnType<typeof buildLines>;
export type ScriptKey = keyof Lines;

const cache = new Map<string, Lines>();
function linesFor(examinerName: string): Lines {
  let l = cache.get(examinerName);
  if (!l) {
    l = buildLines(examinerName);
    cache.set(examinerName, l);
  }
  return l;
}

/** A fixed examiner line. Only the greetings depend on the examiner's name. */
export function line(key: ScriptKey, examinerName: string = EXAMINER_NAME): Clip {
  return { key, text: linesFor(examinerName)[key] };
}

export function allScriptClips(examinerName: string = EXAMINER_NAME): Clip[] {
  return (Object.keys(linesFor(examinerName)) as ScriptKey[]).map((k) => line(k, examinerName));
}

export function greetingFor(localHour: number, examinerName: string = EXAMINER_NAME): Clip {
  if (localHour < 12) return line("open.greet.morning", examinerName);
  if (localHour < 18) return line("open.greet.afternoon", examinerName);
  return line("open.greet.evening", examinerName);
}

export function formatLineFor(mode: ExamMode): Clip {
  return line(`open.format.${mode}` as ScriptKey);
}

export type ProbeId = "why" | "example" | "more" | "compare" | "future" | "agree";
export const PROBE_IDS: ProbeId[] = ["why", "example", "more", "compare", "future", "agree"];

export function probeClip(id: ProbeId): Clip {
  return line(`probe.${id}` as ScriptKey);
}
