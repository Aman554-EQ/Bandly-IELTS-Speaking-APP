import { SignOutButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Account suspended" };

export default function AccountSuspendedPage() {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-semibold">Your account is suspended</h1>
      <p className="mt-3 text-lg text-muted">
        You can&apos;t take tests or see results while your account is suspended. Contact the site administrator if you
        think this is a mistake.
      </p>
      <div className="mt-8 flex justify-center">
        <SignOutButton>
          <Button variant="secondary" size="lg">
            Sign out
          </Button>
        </SignOutButton>
      </div>
    </main>
  );
}
