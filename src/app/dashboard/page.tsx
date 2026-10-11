import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BandPill, MODE_LABEL } from "@/components/report/report-parts";
import { ButtonLink } from "@/components/ui/button";
import { requirePagePermission } from "@/server/auth/session";
import { listSessions } from "@/server/db/repo";

export const metadata: Metadata = { title: "Dashboard" };

const STARTS = [
  { mode: "part1", label: "Part 1" },
  { mode: "part2", label: "Part 2" },
  { mode: "part3", label: "Part 3" },
  { mode: "full", label: "Full test" },
] as const;

async function DashboardBody() {
  await connection();
  const user = await requirePagePermission("exam.take", "/dashboard");
  const recent = await listSessions(user.id, 5);
  const scored = recent.filter((s) => s.overall !== null);
  return (
    <>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
        Welcome{user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-2 text-muted">Pick a test to practice, or open one of your recent results.</p>

      <section aria-labelledby="start" className="mt-8">
        <h2 id="start" className="font-display text-2xl font-semibold">
          Start a test
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STARTS.map((s) => (
            <ButtonLink key={s.mode} href={`/practice?part=${s.mode}`} size="lg" variant="secondary">
              {s.label}
            </ButtonLink>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 id="recent" className="font-display text-2xl font-semibold">
            Recent results
          </h2>
          <Link href="/results" className="font-semibold text-primary underline">
            All results
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="card mt-4 p-6 text-muted">No tests yet. Your results will appear here after your first test.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {recent.map((s) => (
              <li key={s.id} className="card flex items-center gap-4 p-4">
                <BandPill band={s.overall} />
                <span className="flex-1 font-medium">
                  {MODE_LABEL[s.mode]}{" "}
                  <span className="text-muted">
                    · {new Date(s.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </span>
                </span>
                <ButtonLink href={`/results/${s.id}`} size="sm" variant="ghost">
                  Open
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
        {scored.length > 1 && (
          <p className="mt-3 text-sm text-muted">
            Average of your last {scored.length} scored tests:{" "}
            <strong>{(scored.reduce((a, s) => a + (s.overall ?? 0), 0) / scored.length).toFixed(1)}</strong>
          </p>
        )}
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Dashboard</p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading your dashboard…</p>}>
        <DashboardBody />
      </Suspense>
    </div>
  );
}
