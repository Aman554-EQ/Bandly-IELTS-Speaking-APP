import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProfileForm } from "@/components/profile/profile-form";
import { requirePagePermission } from "@/server/auth/session";
import { getProfile } from "@/server/auth/users";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Profile" };

async function ProfileBody() {
  await connection();
  const user = await requirePagePermission("profile.edit_own", "/profile");
  const profile = await getProfile(getDb(), user.id);
  if (!profile) return null;
  return (
    <>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Your profile</h1>
      <p className="mt-2 text-muted">
        Signed in as <strong>{profile.email}</strong> · {profile.roles.join(", ")}. Change your email or password from
        the account menu (your picture, top right).
      </p>
      <ProfileForm profile={profile} />
    </>
  );
}

export default function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Account</p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading…</p>}>
        <ProfileBody />
      </Suspense>
    </div>
  );
}
