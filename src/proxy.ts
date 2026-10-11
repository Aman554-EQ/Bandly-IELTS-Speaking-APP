import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Coarse gate (database-integration.md §6.3 rule 6): signed-out visitors who open
 * a protected page are sent to /sign-in and come back afterwards.
 * Fine-grained checks (roles, ownership, suspended accounts) happen on the
 * server in every page and route handler (src/server/auth/session.ts).
 * API routes are not redirected here: they answer 401/403 as JSON themselves.
 */
const isProtectedPage = createRouteMatcher([
  "/practice(.*)",
  "/results(.*)",
  "/dashboard(.*)",
  "/profile(.*)",
  "/admin(.*)",
  "/superadmin(.*)",
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedPage(req)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    // Everything except Next.js internals and static files (including the examiner's audio clips).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3|wav)).*)",
    "/(api|trpc)(.*)",
  ],
};
