/**
 * Choosing a browser (SpeechSynthesis) voice for the examiner when a line has
 * no pre-rendered clip. The examiner's gender must never flip: a female
 * examiner (Emma) never gets a male voice, and the other way round.
 *
 * Browsers don't report a voice's gender, so names are matched against the
 * known voices of Windows, macOS/iOS, Android/ChromeOS and Chrome. Order of
 * preference: the examiner's own hints → same gender in en-GB → same gender in
 * any English → an unknown-gender English voice (pitch nudged) → none (the UI
 * shows the line as text instead of speaking it in the wrong voice).
 */

export type Gender = "female" | "male";

/** The parts of SpeechSynthesisVoice we use (so this is testable without a browser). */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

const FEMALE = [
  "female",
  "woman",
  // Windows (desktop and Edge "Natural")
  "hazel",
  "susan",
  "zira",
  "libby",
  "sonia",
  "maisie",
  "mia",
  "aria",
  "jenny",
  "michelle",
  "ana",
  "natasha",
  "clara",
  "emily",
  "heera",
  "neerja",
  "catherine",
  "linda",
  "eva",
  // macOS / iOS
  "kate",
  "serena",
  "martha",
  "stephanie",
  "samantha",
  "karen",
  "moira",
  "tessa",
  "fiona",
  "victoria",
  "allison",
  "ava",
  "susan",
  "nicky",
  "veena",
  "kathy",
  "agnes",
  "vicki",
  // Android / ChromeOS voice ids (en-gb-x-gba, gbc, gbd are female)
  "gba",
  "gbc",
  "gbd",
  "sfg",
  "tpf",
];

const MALE = [
  "male",
  "man",
  // Windows
  "george",
  "ryan",
  "thomas",
  "david",
  "mark",
  "guy",
  "james",
  "william",
  "prabhat",
  "ravi",
  "richard",
  "sean",
  // macOS / iOS
  "daniel",
  "arthur",
  "oliver",
  "alex",
  "fred",
  "rishi",
  "aaron",
  "tom",
  "gordon",
  "lee",
  "ralph",
  "bruce",
  "albert",
  // Android / ChromeOS (en-gb-x-gbb, rjs are male)
  "gbb",
  "rjs",
  "iom",
  "tpd",
];

const words = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/** "female", "male" or null (unknown) from a voice name. */
export function genderOf(name: string): Gender | null {
  const w = words(name);
  // "Google UK English Female": the explicit word wins.
  if (w.includes("female") || w.includes("woman")) return "female";
  if (w.includes("male") || w.includes("man")) return "male";
  const f = w.some((x) => FEMALE.includes(x));
  const m = w.some((x) => MALE.includes(x));
  if (f && !m) return "female";
  if (m && !f) return "male";
  return null;
}

const isEnglish = (v: VoiceLike) => v.lang.toLowerCase().replace("_", "-").startsWith("en");
const isBritish = (v: VoiceLike) => v.lang.toLowerCase().replace("_", "-").startsWith("en-gb");

export interface VoiceChoice<V extends VoiceLike> {
  voice: V | null;
  /** 1 = natural. Nudged only when the voice's gender is unknown. */
  pitch: number;
}

/**
 * Picks the examiner's fallback voice. Never returns a voice known to be of
 * the other gender; returns `{ voice: null }` if nothing suitable exists.
 */
export function chooseVoice<V extends VoiceLike>(voices: V[], gender: Gender, hints: string[] = []): VoiceChoice<V> {
  const english = voices.filter(isEnglish);
  const same = english.filter((v) => genderOf(v.name) === gender);
  const hinted = hints
    .map((h) => new RegExp(h, "i"))
    .map((re) => same.find((v) => isBritish(v) && re.test(v.name)))
    .find(Boolean);
  if (hinted) return { voice: hinted, pitch: 1 };
  const sameGb = same.filter(isBritish);
  const pick = (list: V[]) => list.find((v) => v.localService) ?? list[0];
  if (sameGb.length) return { voice: pick(sameGb), pitch: 1 };
  if (same.length) return { voice: pick(same), pitch: 1 };
  // No voice of the right gender: an unknown-gender English voice, nudged towards it.
  const unknown = english.filter((v) => genderOf(v.name) === null);
  const u = pick(unknown.filter(isBritish)) ?? pick(unknown);
  if (u) return { voice: u, pitch: gender === "female" ? 1.15 : 0.85 };
  return { voice: null, pitch: 1 };
}
