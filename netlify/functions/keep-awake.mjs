// Keeps the live site awake: every 5 minutes from 6 am to midnight Eastern (in daylight time 7 am to 1 am; the schedule is
// UTC) it opens two pages as anyone could, so the first person after a quiet spell doesn't wait for the site to start.
// Runs only on the published site, can't be started by a web address, changes nothing and has no login: the Home page
// answers by sending it to the login page, which is enough to have that page's code ready.
const PAGES = ["/login/scenic-city", "/org/thunder"];

export default async function keepAwake() {
  const site = process.env.URL; // the site's own address, set by Netlify
  if (!site) return;
  for (const page of PAGES) {
    const start = Date.now();
    try {
      const r = await fetch(new URL(page, site), { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "keep-awake" } });
      await r.text(); // to the end, so the page finishes
      if (r.status >= 500 || Date.now() - start > 3000) console.warn(`[keep awake] ${page}: ${r.status} in ${Date.now() - start} ms`);
    } catch (e) {
      console.warn(`[keep awake] ${page}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export const config = { schedule: "*/5 11-23,0-4 * * *" };
