import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { directorsPanel } from "@/lib/org-admin";
import { listUsers } from "@/lib/users";
import { familiesOf } from "@/lib/families";
import type { SessionUser } from "@/lib/auth/service";
import { StaffAdd, staffCount } from "../../../UserList";
import { PanelIcon } from "../../../CardIcons";
import { activeCoaches } from "../../../coach-trees";
import { MEGAPHONE_BTN, MegaphoneIcon } from "../../../PageMenus";
import AppHeader from "../../../AppHeader";
import MembersCards from "../../../MembersCards";
import { memberParts } from "./MembersNav";
import CoachesPart from "./parts/Coaches";
import FamiliesPart from "./parts/Families";
import PlayersPart from "./parts/Players";
import RequestsPart from "./parts/Requests";
import StaffPart from "./parts/Staff";

import { PageFrame } from "../../../ui";

// Members: every part this person can see, as cards that open on their own (SPEC.md, Members). ?open=coaches opens that
// card; ?coaches=inactive picks the Coaches card's list (and opens it).
export async function MembersContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/org/thunder/members">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const sp = await searchParams;
  const open = typeof sp.open === "string" ? sp.open : sp.coaches ? "coaches" : null;
  const body = {
    requests: <RequestsPart user={user} />,
    staff: <StaffPart user={user} />,
    coaches: <CoachesPart user={user} view={sp.coaches} />,
    players: <PlayersPart user={user} />,
    families: <FamiliesPart user={user} />,
  };
  const parts = await memberParts(user);
  // Players (n): every registration (the same players the card lists).
  const players = parts.some((p) => p.key === "players")
    ? (await db.query<{ n: number }>("select count(*)::int as n from registrations")).rows[0].n
    : undefined;
  // Staff (n) and its + on the title line (Admins).
  // Coaches (n Active) and its 📣 on the title line (opens Text, Chat, Alert inside the card).
  const staff = parts.some((p) => p.key === "staff");
  const coaches = parts.some((p) => p.key === "coaches");
  const [users, panel] = await Promise.all([
    staff || coaches ? listUsers(user) : [],
    staff ? directorsPanel({ pool: db, now: () => new Date() }, user, "thunder") : null,
  ]);
  const count: Record<string, React.ReactNode> = {
    players,
    staff: staff ? staffCount(users) : undefined,
    coaches: coaches ? `${activeCoaches(users).length} Active` : undefined,
  };
  // Families (n): built from registrations; filled in when ready (the card shows at once).
  const familyCount = (
    <Suspense fallback="…">
      <FamiliesCount user={user} />
    </Suspense>
  );
  const action: Record<string, React.ReactNode> = {
    staff: <StaffAdd team={panel && { org: "thunder", orgName: "Thunder Basketball", ...panel }} thunder />,
    coaches: (
      <PanelIcon id="coach-tools" label="Coaches: text, chat or alert" className={MEGAPHONE_BTN}>
        <MegaphoneIcon />
      </PanelIcon>
    ),
  };
  const cards = parts.map((p) => ({
    ...p,
    count: p.key === "families" ? familyCount : count[p.key],
    action: action[p.key],
    body: body[p.key],
  }));
  return (
    <>
      {!embedded && <AppHeader user={user} tab="members" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersCards cards={cards} open={open} heading={embedded ? null : "Members"} />
      </PageFrame>
    </>
  );
}

async function FamiliesCount({ user }: { user: SessionUser }) {
  return (await familiesOf(user)).length;
}
