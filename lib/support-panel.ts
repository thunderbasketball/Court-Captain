import "server-only";
import type { SessionUser } from "./auth/service";
import { db } from "./db";
import { articlesFor, isFor, listArticles, supportChats, type SupportArticle } from "./support";
import { orgNeeds, supportFor } from "./support-audience";
import { newsFor } from "./whats-new-seen";
import { VERSION } from "./whats-new";

// Support as one person sees it: the articles for them, their chats, and (those who answer) the chats to answer and a look at
// what other people there see, to help them.
export async function supportPanel(user: SessionUser, org: string | null) {
  const [all, me, chats] = await Promise.all([listArticles(db), supportFor(user, org), supportChats(db, user, org)]);
  const news = await newsFor({ pool: db, now: () => new Date() }, user.coachId, me.list);
  const others: { key: string; label: string; articles: SupportArticle[] }[] = [];
  if (chats.inbox && org) {
    const has = await orgNeeds(org);
    for (const [key, label, who] of [
      ["coach", "Coaches", ["coach"]],
      ["staff", "Team staff", ["staff"]],
      ["parent", "Parents", ["parent", "public"]],
      ["director", "Directors", ["director"]],
    ] as const) {
      const f = { who: new Set<string>([...who, "everyone"]), has, areas: new Set(["*"]) };
      others.push({ key, label, articles: all.filter((a) => isFor(a, f)) });
    }
  }
  return { articles: articlesFor(all, me.list), mine: chats.mine, inbox: chats.inbox, staff: me.staff, others, news: { releases: news.releases, fresh: news.fresh }, version: VERSION };
}
