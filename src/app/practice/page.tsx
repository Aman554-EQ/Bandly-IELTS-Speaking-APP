import type { Metadata } from "next";
import { Suspense } from "react";
import { PracticeWizard } from "@/components/practice/setup-step";
import { readPracticeSettings } from "@/content/practice-params";
import { requirePagePermission } from "@/server/auth/session";
import { getProfile } from "@/server/auth/users";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = {
  title: "Speaking practice",
  description: "Choose a part, an examiner and a style, then pick a test. A realistic examiner listens and responds.",
};

/** Step 1 of Practice: part, voice, style (kept in the URL). Profile defaults fill what the URL lacks. */
async function Wizard({ searchParams }: { searchParams: PageProps<"/practice">["searchParams"] }) {
  const sp = await searchParams;
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  const user = await requirePagePermission("exam.take", `/practice${query.size ? `?${query}` : ""}`);
  const prefs = (await getProfile(getDb(), user.id))?.preferences ?? {};
  const s = readPracticeSettings(sp, { examinerId: prefs.examinerId, fidelity: prefs.fidelity });
  return <PracticeWizard initialMode={s.mode} initialExaminer={s.examinerId} initialFidelity={s.fidelity} />;
}

export default function PracticePage(props: PageProps<"/practice">) {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted">Loading…</div>}>
      <Wizard searchParams={props.searchParams} />
    </Suspense>
  );
}
