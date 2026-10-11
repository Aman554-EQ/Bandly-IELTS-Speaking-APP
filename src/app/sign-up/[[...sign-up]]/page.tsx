import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 py-12">
      <h1 className="sr-only">Create your account</h1>
      {/* Clerk reads the URL (redirect_url), which must stream inside Suspense with Cache Components. */}
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <SignUp />
      </Suspense>
    </main>
  );
}
