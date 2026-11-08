import Link from "next/link";

const LINKS = [
  { key: "availability", href: "/org/thunder/facilities", label: "Availability" },
  { key: "gyms", href: "/org/thunder/facilities/gyms", label: "Gyms" },
  { key: "blackouts", href: "/org/thunder/facilities/blackouts", label: "Blackouts" },
  { key: "rentals", href: "/org/thunder/facilities/rentals", label: "Rentals" }, // coming soon
] as const;

// The links inside Facilities (Admins and Directors of Facilities): Thunder's, or (`links`) another organization's
// (Availability and Gyms; blackouts belong to Thunder's practice slots).
export default function FacilitiesNav({
  current,
  links = LINKS,
}: {
  current: string;
  links?: readonly { key: string; href: string; label: string }[];
}) {
  return (
    <nav aria-label="Facilities" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
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
