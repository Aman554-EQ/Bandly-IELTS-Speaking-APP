import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Terms of use", description: "The rules for using Bandly." };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="11 October 2026">
      <p>By using Bandly you agree to these terms. They are short because the service is simple and free.</p>

      <h2>Practice only</h2>
      <p>
        Bandly gives <strong>estimated</strong> band scores for practice. They are not official IELTS results and may
        differ from the score you receive in the real test. Bandly is not affiliated with IELTS, the British Council,
        IDP or Cambridge. See{" "}
        <Link href="/guide" className="text-primary underline">
          how scoring works
        </Link>
        .
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your sign-in details safe; you are responsible for activity on your account.</li>
        <li>Use the service for your own practice. Don&apos;t try to break, overload or misuse it.</li>
        <li>We may suspend accounts that abuse the service.</li>
      </ul>

      <h2>Content</h2>
      <p>
        Questions and cue cards are for practice. Links on the Resources page go to independent websites; their owners
        are responsible for their content.
      </p>

      <h2>No guarantee</h2>
      <p>
        The service is provided as is, without warranties. We may change or pause features at any time. We are not
        liable for decisions made on the basis of estimated scores.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; the date above shows the latest version. Read our{" "}
        <Link href="/privacy" className="text-primary underline">
          privacy policy
        </Link>{" "}
        to see how we handle data.
      </p>
    </LegalPage>
  );
}
