import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { homeFor, primaryRole } from "@/server/auth/policy";
import { getCurrentUser } from "@/server/auth/session";

const linkClass =
  "whitespace-nowrap rounded-lg px-3 py-1.5 text-[15px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink";

const HOME_LABEL = { superadmin: "Superadmin", admin: "Admin", student: "Dashboard" } as const;

/**
 * Account area of the header. Reads the signed-in user from the database
 * (roles come from there), so it streams in inside a Suspense boundary.
 */
export async function HeaderAccount({ variant = "bar" }: { variant?: "bar" | "menu" } = {}) {
  const user = await getCurrentUser();
  if (variant === "menu") {
    // Mobile menu: full-width, easy-to-tap rows.
    const row =
      "flex h-12 items-center justify-center rounded-xl border border-line-strong px-4 font-semibold text-ink hover:bg-surface-2";
    if (!user) {
      return (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/sign-in" className={row}>
            Sign in
          </Link>
          <ButtonLink href="/sign-up" size="lg" className="h-12">
            Sign up
          </ButtonLink>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Link href={homeFor(user)} className={`${row} flex-1`}>
          {HOME_LABEL[primaryRole(user)]}
        </Link>
        <Link href="/profile" className={`${row} flex-1`}>
          Profile
        </Link>
        <span className="grid h-12 w-12 shrink-0 place-items-center">
          <UserButton />
        </span>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/sign-in" className={linkClass}>
          Sign in
        </Link>
        <ButtonLink href="/sign-up" size="sm">
          Sign up
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Link href={homeFor(user)} className={linkClass}>
        {HOME_LABEL[primaryRole(user)]}
      </Link>
      <Link href="/profile" className={linkClass}>
        Profile
      </Link>
      <span className="ml-1 grid h-8 w-8 place-items-center">
        <UserButton />
      </span>
    </div>
  );
}
