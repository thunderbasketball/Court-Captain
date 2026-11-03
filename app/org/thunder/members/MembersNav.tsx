import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";

// Members: Staff (Admins), Coaches (Directors of Coaches), Players and Families (Directors of Players or Teams).
// Admins see them all.
export const memberLinks = (user: SessionUser) =>
  [
    { key: "staff", href: "/org/thunder/members/staff", label: "Staff", show: isThunderAdmin(user) },
    { key: "coaches", href: "/org/thunder/members/coaches", label: "Coaches", show: hasArea(user, "teams") },
    { key: "players", href: "/org/thunder/members/players", label: "Players", show: hasArea(user, "players", "teams") },
    { key: "families", href: "/org/thunder/members/families", label: "Families", show: hasArea(user, "players", "teams") },
  ].filter((l) => l.show);

// People waiting to join Thunder (Admins approve them).
export async function waitingRequests(user: SessionUser): Promise<number> {
  if (!isThunderAdmin(user)) return 0;
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from users u where u.active and has_role(u.coach_id, 'thunder', 'Request')
       and not has_role(u.coach_id, 'thunder', 'Coach') and not has_role(u.coach_id, 'thunder', 'Director')
       and not exists (select 1 from team_staff s where s.coach_id = u.coach_id)`,
  );
  return r.rows[0].n;
}

// Requests shows only while someone is waiting: first, flashing red, with how many.
export default async function MembersNav({
  user,
  current,
}: {
  user: SessionUser;
  current: "staff" | "requests" | "coaches" | "players" | "families";
}) {
  const waiting = await waitingRequests(user);
  const links = [
    ...(waiting ? [{ key: "requests", href: "/org/thunder/members/requests", label: `Requests (${waiting})` }] : []),
    ...memberLinks(user),
  ];
  return (
    <nav aria-label="Members" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
            current === l.key
              ? "border-thunder-orange text-zinc-900 dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          } ${l.key === "requests" && waiting ? "animate-pulse text-red-600! dark:text-red-400!" : ""}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
