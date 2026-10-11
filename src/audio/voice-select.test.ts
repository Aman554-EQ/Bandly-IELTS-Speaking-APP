import { describe, expect, it } from "vitest";
import { EXAMINERS } from "@/engine/examiners";
import { chooseVoice, genderOf, type VoiceLike } from "./voice-select";

const v = (name: string, lang = "en-GB", localService = true): VoiceLike => ({ name, lang, localService });

// Real voice lists (trimmed) as browsers report them.
const WINDOWS_CHROME = [
  v("Microsoft George - English (United Kingdom)"), // listed first: the reported bug
  v("Microsoft Hazel - English (United Kingdom)"),
  v("Microsoft Susan - English (United Kingdom)"),
  v("Microsoft David - English (United States)", "en-US"),
  v("Microsoft Zira - English (United States)", "en-US"),
  v("Google UK English Male", "en-GB", false),
  v("Google UK English Female", "en-GB", false),
];
const WINDOWS_MALE_ONLY_GB = [
  v("Microsoft George - English (United Kingdom)"),
  v("Microsoft Zira - English (United States)", "en-US"),
];
const MAC = [v("Daniel", "en-GB"), v("Kate", "en-GB"), v("Samantha", "en-US"), v("Alex", "en-US")];
const ANDROID = [v("English United Kingdom (en-gb-x-gbb-local)"), v("English United Kingdom (en-gb-x-gba-local)")];

const emma = (voices: VoiceLike[]) => chooseVoice(voices, "female", EXAMINERS.emma.browserVoiceHints);
const james = (voices: VoiceLike[]) => chooseVoice(voices, "male", EXAMINERS.james.browserVoiceHints);

describe("examiner fallback voice keeps the examiner's gender", () => {
  it("Windows: Emma gets a female British voice even when George is listed first", () => {
    expect(emma(WINDOWS_CHROME).voice?.name).toMatch(/Hazel|Susan|Female/);
    expect(james(WINDOWS_CHROME).voice?.name).toMatch(/George|Male/);
  });

  it("no female British voice: Emma uses a female voice in another English, never George", () => {
    expect(emma(WINDOWS_MALE_ONLY_GB).voice?.name).toMatch(/Zira/);
    expect(emma(WINDOWS_MALE_ONLY_GB).pitch).toBe(1);
  });

  it("macOS and Android voices are recognised", () => {
    expect(emma(MAC).voice?.name).toBe("Kate");
    expect(james(MAC).voice?.name).toBe("Daniel");
    expect(emma(ANDROID).voice?.name).toMatch(/gba/);
    expect(james(ANDROID).voice?.name).toMatch(/gbb/);
  });

  it("only voices of the other gender: no voice at all (the line is shown as text instead)", () => {
    expect(emma([v("Microsoft George - English (United Kingdom)"), v("Daniel")]).voice).toBeNull();
    expect(james([v("Kate"), v("Google UK English Female")]).voice).toBeNull();
  });

  it("unknown-gender voices are used only as a last resort, with the pitch nudged", () => {
    const r = emma([v("English Voice 1"), v("Microsoft George - English (United Kingdom)")]);
    expect(r.voice?.name).toBe("English Voice 1");
    expect(r.pitch).toBeGreaterThan(1);
    expect(james([v("English Voice 1")]).pitch).toBeLessThan(1);
  });

  it("non-English voices are never used; empty lists are fine", () => {
    expect(emma([v("Microsoft Hortense - French", "fr-FR")]).voice).toBeNull();
    expect(emma([]).voice).toBeNull();
  });

  it("reads gender from names, with explicit words winning", () => {
    expect(genderOf("Google UK English Female")).toBe("female");
    expect(genderOf("Google UK English Male")).toBe("male");
    expect(genderOf("Microsoft Sonia Online (Natural) - English (United Kingdom)")).toBe("female");
    expect(genderOf("Microsoft Ryan Online (Natural) - English (United Kingdom)")).toBe("male");
    expect(genderOf("German Voice")).toBeNull();
  });
});
