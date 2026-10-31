import Link from "next/link";

const LINKS = [
  { key: "availability", href: "/facilities", label: "Availability" },
  { key: "gyms", href: "/facilities/gyms", label: "Gyms" },
  { key: "blackouts", href: "/facilities/blackouts", label: "Blackouts" },
] as const;

// The links inside Facilities (Admins and Directors of Facilities).
export default function FacilitiesNav({ current }: { current: (typeof LINKS)[number]["key"] }) {
  return (
    <nav aria-label="Facilities" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {LINKS.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
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
