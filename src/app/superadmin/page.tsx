import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccessActions } from "@/components/superadmin/access-actions";
import { ButtonLink } from "@/components/ui/button";
import { listAudit, listUsers, platformCounts } from "@/server/auth/admin-queries";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { LiveSearchForm } from "@/components/ui/live-search-form";

export const metadata: Metadata = { title: "Superadmin" };

const ROLE_TONE = {
  superadmin: "bg-danger-soft text-danger",
  admin: "bg-accent-soft text-accent",
  student: "bg-surface-2 text-muted",
} as const;

type SP = PageProps<"/superadmin">["searchParams"];

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

async function SuperadminBody({ searchParams }: { searchParams: SP }) {
  await connection();
  const me = await requirePagePermission("users.list", "/superadmin");
  const sp = await searchParams;
  const q = str(sp.q);
  const db = getDb();
  const [counts, userPage, audit] = await Promise.all([
    platformCounts(db),
    listUsers(db, { q, cursor: str(sp.cursor), limit: 25 }),
    listAudit(db, { cursor: str(sp.audit), limit: 15 }),
  ]);
  const withParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/superadmin?${p}`;
  };

  return (
    <>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Users and access</h1>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Users", counts.users],
            ["Students", counts.students],
            ["Admins", counts.admins],
            ["Superadmins", counts.superadmins],
            ["Attempts", counts.attempts],
            ["Scored", counts.scored],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted [overflow-wrap:anywhere] sm:text-sm">
              {k}
            </dt>
            <dd className="mt-1 font-display text-3xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="users" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="users" className="font-display text-2xl font-semibold">
            Users
          </h2>
          <LiveSearchForm action="/superadmin" className="flex gap-2" label="Search users">
            <label htmlFor="q" className="sr-only">
              Search users by email or name
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search email or name"
              className="h-9 rounded-xl border border-line-strong bg-surface px-3"
            />
          </LiveSearchForm>
        </div>
        {userPage.items.length === 0 ? (
          <p className="card mt-4 p-6 text-muted">No users match.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {userPage.items.map((u) => (
              <li key={u.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-all sm:truncate sm:break-normal">
                    {u.email}
                    {u.id === me.id && <span className="ml-2 text-sm font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {u.displayName ?? "No name"} · joined {new Date(u.createdAt).toLocaleDateString("en-US")}
                    {u.lastSeenAt && ` · last seen ${new Date(u.lastSeenAt).toLocaleDateString("en-US")}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <span key={r} className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${ROLE_TONE[r]}`}>
                      {r}
                    </span>
                  ))}
                  {u.status !== "active" && (
                    <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-sm font-semibold text-danger">
                      {u.status}
                    </span>
                  )}
                </div>
                <AccessActions userId={u.id} email={u.email} roles={u.roles} status={u.status} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-3">
          {str(sp.cursor) && (
            <ButtonLink href={withParams({})} variant="ghost" size="sm">
              First page
            </ButtonLink>
          )}
          {userPage.nextCursor && (
            <ButtonLink href={withParams({ cursor: userPage.nextCursor })} variant="secondary" size="sm">
              Next page
            </ButtonLink>
          )}
        </div>
      </section>

      <section aria-labelledby="audit" className="mt-12">
        <h2 id="audit" className="font-display text-2xl font-semibold">
          Audit log
        </h2>
        <p className="mt-1 text-sm text-muted">Every role change, denied attempt, profile edit and account event.</p>
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Who</th>
                <th className="p-3">Action</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 align-top">
                  <td className="whitespace-nowrap p-3">{new Date(a.createdAt).toLocaleString("en-US")}</td>
                  <td className="p-3">{a.actorEmail ?? "system"}</td>
                  <td className="p-3 font-mono">{a.action}</td>
                  <td className="max-w-md truncate p-3 font-mono text-xs text-muted" title={JSON.stringify(a.after)}>
                    {a.after ? JSON.stringify(a.after) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {audit.nextCursor && (
          <Link
            href={withParams({ audit: audit.nextCursor })}
            className="mt-3 inline-block font-semibold text-primary underline"
          >
            Older entries
          </Link>
        )}
      </section>
    </>
  );
}

export default function SuperadminPage(props: PageProps<"/superadmin">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Superadmin</p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading…</p>}>
        <SuperadminBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
