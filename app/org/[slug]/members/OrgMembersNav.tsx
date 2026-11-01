import Link from "next/link";

// A registered organization's Members: Staff (its Admins) and Coaches (Admins, Directors of Coaches or Teams).
export default function OrgMembersNav({
  slug,
  current,
  staff,
  coaches,
}: {
  slug: string;
  current: "staff" | "coaches";
  staff: boolean;
  coaches: boolean;
}) {
  const links = [
    { key: "staff", href: `/org/${slug}/members`, label: "Staff", show: staff },
    { key: "coaches", href: `/org/${slug}/members/coaches`, label: "Coaches", show: coaches },
  ].filter((l) => l.show);
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
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
