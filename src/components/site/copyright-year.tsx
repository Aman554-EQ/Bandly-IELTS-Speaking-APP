import { cacheLife } from "next/cache";

/**
 * The current year for the copyright line. Cache Components refuses an
 * unscoped `new Date()` while prerendering, so the read is cached (refreshed
 * daily): pages stay static and the year rolls over by itself.
 */
export async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return <span>{new Date().getFullYear()}</span>;
}
