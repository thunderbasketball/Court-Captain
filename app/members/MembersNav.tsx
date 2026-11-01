import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";

// Members: Staff (Admins), Coaches (Directors of Coaches), Players and Families (Directors of Players or Teams).
// Admins see them all.
export const memberLinks = (user: SessionUser) =>
  [
    { key: "staff", href: "/members/staff", label: "Staff", show: isThunderAdmin(user) },
    { key: "coaches", href: "/members/coaches", label: "Coaches", show: hasArea(user, "coaches") },
    { key: "players", href: "/members/players", label: "Players", show: hasArea(user, "players", "teams") },
    { key: "families", href: "/members/families", label: "Families", show: hasArea(user, "players", "teams") },
  ].filter((l) => l.show);

export default function MembersNav({
  user,
  current,
}: {
  user: SessionUser;
  current: "staff" | "coaches" | "players" | "families";
}) {
  return (
    <nav aria-label="Members" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {memberLinks(user).map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
            current === l.key
              ? "border-thunder-orange text-zinc-900 dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
