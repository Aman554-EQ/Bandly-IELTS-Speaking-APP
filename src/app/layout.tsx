import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { SiteHeader } from "@/components/site/site-header";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Bandly · IELTS Speaking practice", template: "%s · Bandly" },
  description:
    "Practice the IELTS Speaking test with a realistic examiner who listens and responds. Real exam timing, British examiner voices, and part-by-part band scores with feedback.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1512" },
  ],
};

/** Applies the saved theme before first paint (no flash). */
const themeScript = `(function(){try{var t=localStorage.getItem("bandly-theme");if(t!=="light"&&t!=="white"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/auth/continue"
      signUpFallbackRedirectUrl="/auth/continue"
    >
      <html
        lang="en-GB"
        suppressHydrationWarning
        className={`${inter.variable} ${serif.variable} ${mono.variable} h-full`}
      >
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        {/* Browser extensions often stamp attributes on <body> before React loads; ignore those (this element only). */}
        <body className="flex min-h-full flex-col" suppressHydrationWarning>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
          >
            Skip to content
          </a>
          <SiteHeader />
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
