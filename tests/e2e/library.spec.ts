import { expect, type Page, test } from "@playwright/test";
import { signInAsAdmin, signInAsStudent } from "./auth-helpers";

/** The page content, without the site header and footer (they repeat links such as "Part 1"). */
const inMain = (page: Page) => page.locator("#main");

/**
 * Step 3 redesign (step3-redesign-plan.md): the four-category library, the
 * Practice wizard, Makkar cue cards by topic, and the admin Tests / Cue cards
 * areas. These tests write to the development database, so everything they
 * create has a unique name and is deleted at the end.
 */

const unique = () => 500 + Math.floor(Math.random() * 9000);
const idFrom = (page: Page) => new URL(page.url()).pathname.split("/").at(-1)!;

test("the library has exactly four categories; the old “test-exam” link redirects", async ({ page }) => {
  await page.goto("/library");
  await expect(page.locator("#main li a")).toHaveCount(4);
  for (const n of ["Cambridge", "Practice Test Exam", "Recent Real Test Questions", "Makkar Cue Cards"]) {
    await expect(inMain(page).getByRole("link", { name: new RegExp(`^${n}`) })).toBeVisible();
  }
  await page.goto("/library/test-exam");
  await expect(page).toHaveURL(/\/library\/practice-test$/);
  await expect(inMain(page).getByRole("heading", { name: "Practice Test Exam" })).toBeVisible();
});

test("category → part → list of tests → test overview → practice", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/library/practice-test");
  for (const p of ["Part 1", "Part 2", "Part 3", "Full Test"])
    await expect(inMain(page).getByRole("link", { name: new RegExp(`^${p}`) })).toBeVisible();
  await inMain(page)
    .getByRole("link", { name: /^Part 1/ })
    .click();
  await expect(inMain(page).getByRole("heading", { name: "Practice Test Exam: Part 1" })).toBeVisible();
  // Tests, not questions.
  await expect(page.getByText("Practice Test Exam, Test 1, Part 1")).toBeVisible();
  await expect(page.getByText("Do you work, or are you a student?")).toBeHidden();
  await inMain(page).getByRole("link", { name: "View" }).first().click();
  await expect(page.getByText("Do you work, or are you a student?")).toBeVisible();
  await inMain(page)
    .getByRole("link", { name: /Practice this part/ })
    .click();
  await expect(page).toHaveURL(/\/practice\/start\?test=.*part=part1/);
  await expect(inMain(page).getByRole("heading", { name: /Practice Test Exam, Test 1, Part 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin test" })).toBeEnabled();
});

test("Makkar cue cards: topic → card → practice (Part 2); cards never appear in test lists", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/library/makkar-cue-cards");
  await expect(inMain(page).getByRole("heading", { name: "Choose a topic" })).toBeVisible();
  await inMain(page)
    .getByRole("link", { name: /^Experiences/ })
    .click();
  await inMain(page).getByRole("link", { name: "View" }).first().click();
  await expect(inMain(page).getByRole("figure", { name: "Cue card" })).toContainText("You should say:");
  await inMain(page).getByRole("link", { name: "Practice this cue card" }).click();
  await expect(page).toHaveURL(/\/practice\/start\?card=/);
  await expect(inMain(page).getByRole("heading", { name: /Experiences, Part 2/ })).toBeVisible();

  await page.goto("/practice/tests?part=part2&voice=female&style=exam");
  await expect(page.getByText(/Describe a play or a film/)).toBeHidden();
  await expect(inMain(page).getByRole("link", { name: /Browse Makkar Cue Cards/ })).toBeVisible();
});

test("Practice wizard: choices stay in the URL through the test list and back", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/practice");
  await page.getByRole("radio", { name: /^Part 2/ }).click();
  await page.getByRole("radio", { name: /Male voice/ }).click();
  await page.getByRole("radio", { name: /Guided style/ }).click();
  await expect(page).toHaveURL(/\/practice\?part=part2&voice=male&style=guided/);
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Part 2/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Male voice/ })).toHaveAttribute("aria-checked", "true");
  await inMain(page)
    .getByRole("link", { name: /See available tests/ })
    .click();
  await expect(inMain(page).getByRole("heading", { name: "Part 2 tests" })).toBeVisible();
  const rows = page.locator("#main li.card p.text-lg");
  for (const t of await rows.allTextContents()) expect(t).toMatch(/, Part 2$/);
  await page.goBack();
  await expect(page.getByRole("radio", { name: /Guided style/ })).toHaveAttribute("aria-checked", "true");
});

test("students can't reach the admin areas or APIs", async ({ page }) => {
  await signInAsStudent(page);
  for (const p of ["/admin/tests", "/admin/cue-cards"]) {
    await page.goto(p);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  }
  const r1 = await page.request.post("/api/admin/tests", {
    data: { op: "book.delete", id: "0192f000-0000-7000-8000-000000000000" },
  });
  const r2 = await page.request.post("/api/admin/cue-cards", { data: { op: "cueTopic.create", title: "Hack" } });
  expect([r1.status(), r2.status()]).toEqual([403, 403]);
});

test("admin: create a test with Parts 1 and 2, fill it, publish, and find it only under those parts", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const n = unique();
  await signInAsAdmin(page);
  await page.goto("/admin/tests/new");
  const form = page.getByRole("form", { name: "New test" });
  await form.getByLabel("Category").selectOption({ label: "Recent Real Test Questions" });
  await form.getByLabel("Test number").fill(String(n));
  await form.getByLabel("Part 3").uncheck();
  await expect(form.getByLabel(/Full Test/)).toBeDisabled();
  await form.getByRole("button", { name: "Create test" }).click();
  await expect(page).toHaveURL(/\/admin\/tests\/.+\?tab=part1/);
  const id = idFrom(page);
  try {
    // Part 1: a topic and two questions.
    const topic = page.getByRole("form", { name: "New topic" });
    await topic.getByLabel("Title").fill("Hometown");
    await topic.getByLabel("What the examiner says first").fill("Let's talk about your hometown.");
    await topic.getByRole("button", { name: "Add topic" }).click();
    const add = page.getByRole("form", { name: "Add a question" });
    for (const q of ["Where is your hometown?", "What do you like about it?"]) {
      await add.getByLabel("New question").fill(q);
      await add.getByRole("button", { name: "+ Add question" }).click();
      await expect(page.getByLabel("Question text").last()).toHaveValue(q);
    }
    // Part 3 can't receive questions: it isn't in this test.
    await inMain(page)
      .getByRole("link", { name: /^Part 3/ })
      .click();
    await expect(page.getByText("This test has no Part 3.")).toBeVisible();
    // Part 2: the card, with a live preview.
    await inMain(page)
      .getByRole("link", { name: /^Part 2/ })
      .click();
    const card = page.getByRole("form", { name: "Cue card" });
    await card.getByLabel("Card heading").fill("Describe a park you like.");
    await expect(inMain(page).getByRole("figure", { name: "Cue card" })).toContainText("Describe a park you like.");
    await card.getByLabel(/Bullet points/).fill("where it is\nwhat you do there");
    await card.getByLabel("Last line of the card").fill("and explain why you like it.");
    await card.getByRole("button", { name: "Add cue card" }).click();
    await expect(page.getByText("This part is complete.")).toBeVisible();
    // Publish.
    await inMain(page)
      .getByRole("link", { name: /^Overview/ })
      .click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(inMain(page).getByRole("status").filter({ hasText: "The test is published." })).toBeVisible();
    // Students see it under Part 1 and Part 2 only.
    const label = `Recent Real Test Questions, Test ${n}`;
    await page.goto("/library/recent-real-test/part-1");
    await expect(page.getByText(`${label}, Part 1`)).toBeVisible();
    await page.goto("/library/recent-real-test/part-3");
    await expect(page.getByText(label)).toBeHidden();
  } finally {
    await page.request.post("/api/admin/tests", { data: { op: "test.delete", id } });
  }
});

test("admin: cue card topic and card, published, visible to students", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const topicName = `E2E topic ${unique()}`;
  await signInAsAdmin(page);
  await page.goto("/admin/cue-cards");
  await page.getByText("+ New topic").click();
  const tf = page.getByRole("form", { name: "New topic" });
  await tf.getByLabel("Topic name").fill(topicName);
  await tf.getByRole("button", { name: "Add topic" }).click();
  await expect(inMain(page).getByRole("heading", { name: topicName })).toBeVisible();
  const topicId = new URL(page.url()).searchParams.get("topic")!;
  let cardId = "";
  try {
    await inMain(page).getByRole("link", { name: "+ New cue card" }).click();
    const cf = page.getByRole("form", { name: "Cue card" });
    await cf.getByLabel("Card heading").fill("Describe a skill you learned.");
    await cf.getByLabel(/Bullet points/).fill("what it is\nhow you learned it");
    await cf.getByLabel("Last line of the card").fill("and explain why it is useful.");
    await cf.getByRole("button", { name: "Create cue card" }).click();
    await expect(page).toHaveURL(/\/admin\/cue-cards\/[0-9a-f-]{36}$/);
    cardId = idFrom(page);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(inMain(page).getByRole("status").filter({ hasText: "The cue card is published." })).toBeVisible();
    // Deleting the topic is refused while it has a card.
    const del = await page.request.post("/api/admin/cue-cards", { data: { op: "cueTopic.delete", id: topicId } });
    expect(del.status()).toBe(409);
    await page.goto("/library/makkar-cue-cards");
    await inMain(page)
      .getByRole("link", { name: new RegExp(`^${topicName}`) })
      .click();
    await expect(page.getByText("Describe a skill you learned.")).toBeVisible();
  } finally {
    if (cardId) await page.request.post("/api/admin/cue-cards", { data: { op: "cueCard.delete", id: cardId } });
    await page.request.post("/api/admin/cue-cards", { data: { op: "cueTopic.delete", id: topicId } });
  }
});

test("admin: paste several questions, regroup one, see the examiner order and find it in the bank", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const n = unique();
  await signInAsAdmin(page);
  await page.goto("/admin/tests/new");
  const form = page.getByRole("form", { name: "New test" });
  await form.getByLabel("Category").selectOption({ label: "Recent Real Test Questions" });
  await form.getByLabel("Test number").fill(String(n));
  await form.getByLabel("Part 2").uncheck();
  await form.getByLabel("Part 3").uncheck();
  await form.getByRole("button", { name: "Create test" }).click();
  await expect(page).toHaveURL(/\/admin\/tests\/.+\?tab=part1/);
  const id = idFrom(page);
  const word = `zebra${n}`;
  try {
    for (const [title, intro] of [
      ["Hometown", "Let's talk about your hometown."],
      ["Music", "Now, let's talk about music."],
    ]) {
      const topic = page.getByRole("form", { name: "New topic" });
      await topic.getByLabel("Title").fill(title);
      await topic.getByLabel("What the examiner says first").fill(intro);
      await topic.getByRole("button", { name: "Add topic" }).click();
      await expect(page.getByRole("region", { name: `Topic: ${title}` })).toBeVisible();
    }
    const home = page.getByRole("region", { name: "Topic: Hometown" });
    await home.getByLabel("several (one per line)").check();
    await home
      .getByLabel("New questions, one per line")
      .fill(`Where is your hometown?\nIs it a ${word} place?\nWhat do you like about it?`);
    await home.getByRole("button", { name: "+ Add 3 questions" }).click();
    await expect(home.getByLabel("Question text")).toHaveCount(3);
    // Regroup the middle one into "Music".
    await home.getByLabel(`Move to another topic: Is it a ${word} place?`).selectOption({ label: "Music" });
    const music = page.getByRole("region", { name: "Topic: Music" });
    await expect(music.getByLabel("Question text")).toHaveValue(`Is it a ${word} place?`);
    await expect(home.getByLabel("Question text")).toHaveCount(2);
    // The engine's order: Hometown's two questions, then Music's.
    await inMain(page).getByRole("link", { name: "Exam order" }).click();
    const order = page.getByRole("list", { name: "Examiner order: Part 1" });
    await expect(order.getByText("Question 1")).toBeVisible();
    await expect(order.locator("li", { hasText: "Question 3" })).toContainText(`Is it a ${word} place?`);
    // The question bank finds it and links back to the test.
    // Live search: typing updates the results and the URL, with no Search button.
    await page.goto("/admin/questions");
    await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);
    await page.getByPlaceholder("words in the question or topic").fill(word);
    await expect(page).toHaveURL((u) => u.pathname === "/admin/questions" && u.searchParams.get("q") === word);
    await expect(
      inMain(page)
        .getByRole("status")
        .filter({ hasText: /question/ }),
    ).toHaveText("1 question.");
    await inMain(page)
      .getByRole("link", { name: `Is it a ${word} place?` })
      .click();
    await expect(page).toHaveURL((u) => u.pathname === `/admin/tests/${id}` && u.search === "?tab=part1");
  } finally {
    await page.request.post("/api/admin/tests", { data: { op: "test.delete", id } });
  }
});

test("band calculator: overall band with official rounding, Listening and Reading conversion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Band calculator" }).click();
  await expect(inMain(page).getByRole("heading", { name: "IELTS band score calculator" })).toBeVisible();
  // The screenshot's example: 8.5, 8.0, 7.0, 7.5 → average 7.75 → 8.0.
  for (const [m, v] of [
    ["Listening", "8.5"],
    ["Reading", "8.0"],
    ["Writing", "7.0"],
    ["Speaking", "7.5"],
  ]) {
    await page.getByLabel(m, { exact: true }).selectOption(v);
  }
  await expect(page.getByRole("img", { name: "Overall band: 8.0" })).toBeVisible();
  await page.getByLabel("Writing", { exact: true }).selectOption("6.5"); // 7.625 → 7.5
  await expect(page.getByRole("img", { name: "Overall band: 7.5" })).toBeVisible();

  await page.getByRole("tab", { name: "Reading" }).click();
  await page.getByLabel("Correct answers (out of 40)").fill("30");
  await expect(page.getByRole("img", { name: "Academic Reading band: 7.0" })).toBeVisible();
  await page.getByRole("radio", { name: "General Training" }).click();
  await expect(page.getByRole("img", { name: "General Training Reading band: 6.0" })).toBeVisible();
});

test("resources: sections, search and external links", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Resources" }).click();
  await expect(inMain(page).getByRole("heading", { name: /Everything for IELTS preparation/ })).toBeVisible();
  for (const h of ["Listening", "Reading", "Writing", "Speaking", "Mock tests"]) {
    await expect(inMain(page).getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
  await page.getByLabel("Search resources").fill("makkar");
  await expect(inMain(page).getByRole("status")).toHaveText(/^2 resources match\./);
  const link = inMain(page).getByRole("link", { name: /Latest Makkar Cue Cards/ });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", "https://practicepteonline.com/ielts-speaking-latest-makkar-cue-cards/");
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Official" }).click();
  await expect(inMain(page).getByRole("link", { name: /British Council — IELTS Preparation/ })).toBeVisible();
  await expect(inMain(page).getByRole("link", { name: /IELTS Liz Listening/ })).toBeHidden();
});
