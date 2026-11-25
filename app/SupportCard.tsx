import type { SessionUser } from "@/lib/auth/service";
import { supportPanel } from "@/lib/support-panel";
import { SupportPanel } from "./support/SupportPanel";

// Support as a Home card (every organization): the same as the header's ?.
export default async function SupportCard({ user, org }: { user: SessionUser; org: string }) {
  const p = await supportPanel(user, org);
  return <SupportPanel org={org} articles={p.articles} mine={p.mine} inbox={p.inbox} staff={p.staff} others={p.others} news={p.news} version={p.version} />;
}
