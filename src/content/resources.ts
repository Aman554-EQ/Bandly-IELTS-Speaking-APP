/**
 * IELTS Resources page content: a curated list of external IELTS materials
 * (from the awesome-IELTS collection by Aman554-EQ), grouped by skill, plus
 * links to Bandly's own tools. Edit here; the page renders whatever is listed.
 */

export interface Resource {
  title: string;
  url: string;
  /** One line: what you get there. */
  note: string;
  tags?: ("Academic" | "General Training" | "Video" | "Practice tests" | "Lessons" | "Official")[];
}

export interface ResourceSection {
  id: string;
  title: string;
  /** Short label for the section chips. */
  short: string;
  color: string;
  intro: string;
  /** Bandly pages related to this section (internal links). */
  inBandly?: { label: string; href: string }[];
  items: Resource[];
}

export const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    id: "band-scores",
    title: "Band score explained",
    short: "Band scores",
    color: "#7c3aed",
    intro: "Understand how bands are given, so you can set a realistic target and see where marks come from.",
    inBandly: [
      { label: "Band score calculator", href: "/band-calculator" },
      { label: "How Speaking is scored", href: "/guide" },
    ],
    items: [
      {
        title: "Band Score Explained",
        url: "https://ieltsliz.com/ielts-band-scores/",
        note: "What each band means and how the overall score is worked out.",
        tags: ["Lessons"],
      },
      {
        title: "IELTS 2026 Explained in 31 Minutes",
        url: "https://www.youtube.com/watch?v=3n4uSDoI438",
        note: "A video overview of the whole test: format, timing and scoring.",
        tags: ["Video"],
      },
    ],
  },
  {
    id: "listening",
    title: "Listening",
    short: "Listening",
    color: "#d97706",
    intro: "Lessons, strategies and full practice tests to improve your Listening score.",
    inBandly: [{ label: "Convert a Listening score", href: "/band-calculator" }],
    items: [
      {
        title: "IELTS Liz Listening",
        url: "https://ieltsliz.com/ielts-listening/",
        note: "Free lessons, tips and practice for every Listening question type.",
        tags: ["Lessons"],
      },
      {
        title: "Mini-IELTS Listening Tests",
        url: "https://mini-ielts.com",
        note: "Short online Listening tests with instant answers.",
        tags: ["Practice tests"],
      },
      {
        title: "204 IELTS Listening Tests",
        url: "https://practicepteonline.com/ielts-listening-tests-ielts-listening-practice-test-ielts-listening-pdf-ielts-cambridge-test/",
        note: "A large bank of full Listening tests with audio and answers.",
        tags: ["Practice tests"],
      },
      {
        title: "Cambridge IELTS Books & Tests (1–21)",
        url: "https://practicepteonline.com/official-ielts-tests/",
        note: "Tests from the Cambridge IELTS series, books 1 to 21.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS UP Listening Practice",
        url: "https://ielts-up.com",
        note: "Listening practice tests and exercises, sorted by difficulty.",
        tags: ["Practice tests"],
      },
    ],
  },
  {
    id: "reading",
    title: "Reading",
    short: "Reading",
    color: "#2563eb",
    intro: "Question types, reading strategies, and practice tests for both Academic and General Training.",
    inBandly: [{ label: "Convert a Reading score", href: "/band-calculator" }],
    items: [
      {
        title: "IELTS Reading Question Types",
        url: "https://ieltsliz.com/ielts-reading-question-types/",
        note: "Every Reading question type, with a strategy for each.",
        tags: ["Lessons"],
      },
      {
        title: "Skimming and Scanning",
        url: "https://takeielts.britishcouncil.org/blog/skimming-and-scanning-ielts-reading-tips",
        note: "British Council tips for finding answers fast.",
        tags: ["Lessons", "Official"],
      },
      {
        title: "IELTS Liz Reading",
        url: "https://ieltsliz.com/ielts-reading-lessons-information-and-tips/",
        note: "Reading lessons, information and tips.",
        tags: ["Lessons"],
      },
      {
        title: "Reading Question Types: Ordered vs Unordered",
        url: "https://intellecta.app/guides/ielts-reading-question-types",
        note: "Which question types follow the order of the passage, and which don't.",
        tags: ["Lessons"],
      },
      {
        title: "Which IELTS Reading Answers Are Not in Order?",
        url: "https://www.allearsenglish.com/ielts-energy-1379-part-2-which-ielts-reading-answers-are-not-in-order/",
        note: "A podcast episode on the question types that jump around the text.",
        tags: ["Lessons"],
      },
      {
        title: "Mini-IELTS Reading Tests",
        url: "https://mini-ielts.com/reading",
        note: "Short online Reading tests with instant answers.",
        tags: ["Practice tests"],
      },
      {
        title: "315 IELTS Academic Reading Tests",
        url: "https://practicepteonline.com/ielts-reading-tests/",
        note: "A large bank of Academic Reading tests with answers.",
        tags: ["Practice tests", "Academic"],
      },
      {
        title: "100 IELTS General Reading Tests",
        url: "https://practicepteonline.com/ielts-general-reading-tests/",
        note: "General Training Reading tests with answers.",
        tags: ["Practice tests", "General Training"],
      },
      {
        title: "Cambridge IELTS Books (1–15)",
        url: "https://ieltspracticeonline.com/ielts-books/",
        note: "Reading practice from the Cambridge IELTS books 1 to 15.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS UP Academic Reading Tests",
        url: "https://ielts-up.com/reading/ielts-reading-practice.html#academic",
        note: "Academic Reading practice, test by test.",
        tags: ["Practice tests", "Academic"],
      },
      {
        title: "IELTS UP General Reading Tests",
        url: "https://ielts-up.com/reading/ielts-reading-practice.html#general",
        note: "General Training Reading practice, test by test.",
        tags: ["Practice tests", "General Training"],
      },
    ],
  },
  {
    id: "writing",
    title: "Writing",
    short: "Writing",
    color: "#e11d48",
    intro: "Lessons, topics, vocabulary and sample essays for Writing Task 1 and Task 2.",
    items: [
      {
        title: "IELTS Writing Task 1 for Academic",
        url: "https://ieltsliz.com/ielts-writing-task-1-lessons-and-tips/",
        note: "How to describe charts, graphs, maps and processes.",
        tags: ["Lessons", "Academic"],
      },
      {
        title: "IELTS Writing Task 2 for Academic",
        url: "https://ieltsliz.com/ielts-writing-task-2/",
        note: "Essay types, structure and model answers.",
        tags: ["Lessons", "Academic"],
      },
      {
        title: "IELTS Writing Task 1 for General Training",
        url: "https://ieltsliz.com/ielts-writing-task-1-lessons-and-tips/#GT-letter",
        note: "How to write formal, semi-formal and informal letters.",
        tags: ["Lessons", "General Training"],
      },
      {
        title: "IELTS Writing Task 1: Lessons, Tips and Strategies",
        url: "https://www.ieltsbuddy.com/ielts-writing-task-1.html",
        note: "Step-by-step Task 1 lessons with examples.",
        tags: ["Lessons"],
      },
      {
        title: "Collection of IELTS Writing Task 2 Topics",
        url: "https://writing9.com/ielts-writing-task-2-topics",
        note: "Recent and common Task 2 questions to practice with.",
        tags: ["Practice tests"],
      },
      {
        title: "Model Essays with Feedback",
        url: "https://www.ieltsbuddy.com/ielts-sample-essays.html",
        note: "Sample essays with examiner-style comments.",
        tags: ["Lessons"],
      },
      {
        title: "IELTS Writing Vocabulary",
        url: "https://ielts-up.com/writing/ielts-vocabulary-writing.html",
        note: "Useful words and phrases for Task 1 and Task 2.",
        tags: ["Lessons"],
      },
    ],
  },
  {
    id: "speaking",
    title: "Speaking",
    short: "Speaking",
    color: "#0d9488",
    intro: "Topics, vocabulary and cue cards for Speaking Parts 1, 2 and 3.",
    inBandly: [
      { label: "Practice with a live examiner", href: "/practice" },
      { label: "Makkar Cue Cards library", href: "/library/makkar-cue-cards" },
      { label: "Speaking test guide", href: "/guide" },
    ],
    items: [
      {
        title: "IELTS Speaking Vocabulary",
        url: "https://ielts-up.com/speaking/ielts-vocabulary-speaking.html",
        note: "Topic vocabulary to sound natural and precise.",
        tags: ["Lessons"],
      },
      {
        title: "IELTS Speaking Part 1 Topics",
        url: "https://ieltsliz.com/ielts-speaking-part-1-topics/",
        note: "Common Part 1 topics and questions.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS Speaking Part 2 Topics",
        url: "https://ieltsliz.com/ielts-speaking-part-2-topics/",
        note: "Cue card topics for the long turn.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS Speaking Part 3 Topics",
        url: "https://ieltsliz.com/ielts-speaking-part-3-topics-2/",
        note: "Discussion questions linked to Part 2 topics.",
        tags: ["Practice tests"],
      },
      {
        title: "Makkar IELTS – Complete Guide for Students",
        url: "https://banglayielts.com/blog/makkar-ielts",
        note: "What the Makkar book is and how to use it.",
        tags: ["Lessons"],
      },
      {
        title: "Latest Makkar Cue Cards for IELTS Speaking",
        url: "https://practicepteonline.com/ielts-speaking-latest-makkar-cue-cards/",
        note: "The latest Makkar cue cards with sample answers.",
        tags: ["Practice tests"],
      },
    ],
  },
  {
    id: "mock-tests",
    title: "Mock tests",
    short: "Mock tests",
    color: "#4f46e5",
    intro: "Check your level under exam conditions, practice time management and find what needs more work.",
    inBandly: [{ label: "Full Speaking mock test", href: "/practice?part=full" }],
    items: [
      {
        title: "OnMock",
        url: "https://www.onmock.com/",
        note: "Computer-delivered style IELTS mock tests.",
        tags: ["Practice tests"],
      },
      {
        title: "Jumpinto",
        url: "https://www.jumpinto.com/",
        note: "Online IELTS mock tests and practice.",
        tags: ["Practice tests"],
      },
      {
        title: "Engnovate",
        url: "https://engnovate.com/",
        note: "Free mock tests for all four modules.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS Next",
        url: "https://ieltsnext.online/",
        note: "Online mock tests with scoring.",
        tags: ["Practice tests"],
      },
      {
        title: "CD IELTS",
        url: "https://cdielts.org/",
        note: "Computer-delivered IELTS practice.",
        tags: ["Practice tests"],
      },
      {
        title: "Keen IELTS",
        url: "https://keenielts.com/",
        note: "Mock tests and practice materials.",
        tags: ["Practice tests"],
      },
      {
        title: "IELTS Academic Mock Tests — Year Wise",
        url: "https://ieltsonlinetests.com/ielts-exam-library#academic",
        note: "Academic mock tests organised by year.",
        tags: ["Practice tests", "Academic"],
      },
      {
        title: "IELTS GT Mock Tests — Year Wise",
        url: "https://ieltsonlinetests.com/ielts-exam-library#general-test",
        note: "General Training mock tests organised by year.",
        tags: ["Practice tests", "General Training"],
      },
    ],
  },
  {
    id: "more",
    title: "Additional and official resources",
    short: "More & official",
    color: "#475569",
    intro: "Official preparation materials and more websites with lessons, strategies and practice.",
    items: [
      {
        title: "IELTS Simon",
        url: "https://ielts-simon.study/",
        note: "Lessons and tips from a former IELTS examiner.",
        tags: ["Lessons"],
      },
      {
        title: "Useful Resources by IELTS Liz",
        url: "https://ieltsliz.com/useful-websites-and-resources-for-ielts/",
        note: "A hand-picked list of further websites.",
        tags: ["Lessons"],
      },
      {
        title: "IELTS.org — Official Preparation Resources",
        url: "https://ielts.org/take-a-test/preparation-resources",
        note: "Official sample tests and preparation from the test owners.",
        tags: ["Official"],
      },
      {
        title: "British Council — IELTS Preparation Materials",
        url: "https://takeielts.britishcouncil.org/prepare/ielts-preparation-materials",
        note: "Free official practice materials and courses.",
        tags: ["Official"],
      },
      {
        title: "IDP IELTS",
        url: "https://www.idp.com/ielts/",
        note: "Book a test and use IDP's free preparation.",
        tags: ["Official"],
      },
    ],
  },
];

export const RESOURCE_COUNT = RESOURCE_SECTIONS.reduce((n, s) => n + s.items.length, 0);

/** "https://www.ieltsbuddy.com/x" → "ieltsbuddy.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
