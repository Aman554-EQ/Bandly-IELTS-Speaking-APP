import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Bandly stores, why, and your choices.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="11 October 2026">
      <p>
        Bandly is a non-commercial IELTS Speaking practice project. This page explains, in plain words, what we keep and
        why. We collect only what the app needs to work.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and profile picture from sign-in (handled by Clerk),
          and the preferences you set in your profile.
        </li>
        <li>
          <strong>Your practice tests:</strong> the transcripts of your answers, the examiner&apos;s timeline, and your
          scores and feedback, so you can see your results and progress.
        </li>
        <li>
          <strong>Newsletter:</strong> if you subscribe in the footer, your email address and the date.
        </li>
        <li>
          <strong>Security logs:</strong> administrative actions are recorded in an audit log, which may include an IP
          address and browser type.
        </li>
      </ul>

      <h2>Your voice recordings</h2>
      <p>
        While you answer, your recording is sent to our speech-recognition and assessment provider (Groq) to transcribe
        and assess it. <strong>We do not store the audio</strong>: only the transcript and the results are saved.
      </p>

      <h2>Who processes your data</h2>
      <ul>
        <li>Clerk: sign-in and account security.</li>
        <li>Groq: speech-to-text and the language model that scores your answers.</li>
        <li>Our database host: stores the data listed above.</li>
      </ul>
      <p>We never sell your data or use it for advertising.</p>

      <h2>Cookies and storage</h2>
      <p>
        We use the cookies needed for signing in, and your browser&apos;s storage for small preferences such as the
        colour theme. Videos from YouTube load only when you press play, using YouTube&apos;s privacy-enhanced mode.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Update your name and preferences on your{" "}
          <Link href="/profile" className="text-primary underline">
            profile
          </Link>
          .
        </li>
        <li>Ask us to delete your account and practice history, or to remove you from the newsletter, at any time.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions or requests: contact the maintainer through{" "}
        <a
          href="https://github.com/Aman554-EQ"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          GitHub (Aman554-EQ)
        </a>
        .
      </p>
    </LegalPage>
  );
}
