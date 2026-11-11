import type { SessionUser } from "@/lib/auth/service";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { listArticles, supportChats } from "@/lib/support";
import { SupportPanel } from "./support/SupportButton";

// Support as a Home card (every organization): the same questions, guides and chats as the Support button.
export default async function SupportCard({ user, org }: { user: SessionUser; org: string }) {
  const [articles, chats, { contexts }] = await Promise.all([listArticles(db), supportChats(db, user, org), currentContexts(user)]);
  return (
    <SupportPanel
      org={org}
      articles={articles}
      mine={chats.mine}
      inbox={chats.inbox}
      staff={contexts.some((c) => c.key === "platform")}
    />
  );
}
