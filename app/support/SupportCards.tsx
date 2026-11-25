import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { supportFor } from "@/lib/support-audience";
import { newsFor } from "@/lib/whats-new-seen";
import { VERSION } from "@/lib/whats-new";
import { NewsCard, SupportLazyCard } from "./LazyCards";

// What's New (highlighted until it's opened, then for the rest of that login) just above Support, at the end of the pages of
// people whose start isn't an organization's Home: a team's page, My dashboard and a new account's start. `org`: the
// organization the page is in, or null (all of theirs). Viewing as someone shows what they'd see, and marks nothing.
export default async function SupportCards({ org }: { org: string | null }) {
  const user = await currentUser();
  if (!user) return null;
  const news = await newsFor({ pool: db, now: () => new Date() }, user.coachId, (await supportFor(user, org)).list);
  return (
    <>
      {news.show && (
        <NewsCard releases={news.highlight ? news.releases.filter((r) => news.fresh.includes(r.version)) : news.releases.slice(0, 1)} fresh={news.fresh} />
      )}
      <SupportLazyCard org={org} version={VERSION} />
    </>
  );
}
