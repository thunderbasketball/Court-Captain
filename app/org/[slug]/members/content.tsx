import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { directorsPanel } from "@/lib/org-admin";
import { listOrgMembers } from "@/lib/org-members";
import { StaffAdd, staffCount } from "../../../UserList";
import { PanelIcon } from "../../../CardIcons";
import { activeCoaches } from "../../../coach-trees";
import { MEGAPHONE_BTN, MegaphoneIcon } from "../../../PageMenus";
import { followRename } from "@/lib/org-rename";
import AppHeader from "../../../AppHeader";
import MembersCards from "../../../MembersCards";
import { orgMemberParts } from "./OrgMembersNav";
import OrgCoachesPart from "./parts/Coaches";
import OrgStaffPart from "./parts/Staff";

import { PageFrame } from "../../../ui";

// A registered organization's Members: every part this person can see, as cards that open on their own (the same as
// Thunder's). ?open=coaches opens that card; ?coaches=inactive picks the Coaches card's list (and opens it).
export async function OrgMembersContent({
  params,
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  params: PageProps<"/org/[slug]/members">["params"];
  searchParams?: PageProps<"/org/[slug]/members">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  await followRename(slug, (s) => `/org/${s}/members`);
  const o = await orgInfo(db, slug);
  if (!o || slug === "thunder" || slug === "scenic-city") {
    if (embedded) return null;
    notFound();
  }
  const parts = await orgMemberParts(user, slug);
  if (!parts.length) {
    if (embedded) return null;
    notFound();
  }
  const sp = await searchParams;
  const open = typeof sp.open === "string" ? sp.open : sp.coaches ? "coaches" : null;
  const body = {
    staff: <OrgStaffPart user={user} slug={slug} />,
    coaches: <OrgCoachesPart user={user} slug={slug} view={sp.coaches} />,
  };
  // Staff (n) and its + on the title line (Owners and Admins).
  // Coaches (n Active) and its 📣 on the title line (opens Text, Chat, Alert inside the card).
  const staff = parts.some((p) => p.key === "staff");
  const [members, panel] = await Promise.all([
    listOrgMembers(db, user, slug),
    staff ? directorsPanel({ pool: db, now: () => new Date() }, user, slug) : null,
  ]);
  const cards = parts.map((p) => ({
    ...p,
    count:
      p.key === "staff" && members
        ? staffCount(members.users)
        : p.key === "coaches" && members
          ? `${activeCoaches(members.users).length} Active`
          : undefined,
    action:
      p.key === "staff" && panel ? (
        <StaffAdd team={{ org: slug, orgName: o.name, ...panel }} thunder={false} />
      ) : p.key === "coaches" ? (
        <PanelIcon id="coach-tools" label="Coaches: text, chat or alert" className={MEGAPHONE_BTN}>
          <MegaphoneIcon />
        </PanelIcon>
      ) : undefined,
    body: body[p.key],
  }));
  return (
    <>
      {!embedded && <AppHeader user={user} context={`org:${slug}`} tab="org-members" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersCards cards={cards} open={open} heading={embedded ? null : "Members"} />
      </PageFrame>
    </>
  );
}
