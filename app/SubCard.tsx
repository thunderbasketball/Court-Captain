import type { ReactNode } from "react";

const Chevron = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180">
    <path
      fillRule="evenodd"
      d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
      clipRule="evenodd"
    />
  </svg>
);

// A card inside a Home card (Registrations, Teams, To Do…): its title with a count in brackets, flashing red while it
// has something to fix (`alert`), opening and closing on its own. `action`: buttons on the title line that don't toggle it.
export default function SubCard({
  title,
  count,
  alert = false,
  open = false,
  action,
  children,
}: {
  title: string;
  count?: ReactNode;
  alert?: boolean;
  open?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <details
        className={`group/s overflow-hidden rounded-xl bg-white ring-1 dark:bg-zinc-900 ${
          alert ? "ring-red-300 dark:ring-red-500/40" : "ring-zinc-950/10 dark:ring-white/10"
        }`}
        open={open}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
          <span
            className={`min-w-0 font-semibold ${action ? "pr-14" : ""} ${alert ? "animate-pulse text-red-600 dark:text-red-400" : ""}`}
          >
            {title}
            {count !== undefined && count !== null && <span className="font-normal text-zinc-500"> ({count})</span>}
          </span>
          <Chevron />
        </summary>
        <div className="border-t border-zinc-100 p-3 dark:border-white/5">{children}</div>
      </details>
      {action && <div className="absolute top-1.5 right-11">{action}</div>}
    </div>
  );
}
