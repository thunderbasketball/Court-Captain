import { Suspense, type ReactNode } from "react";
import { card } from "./ui";

// action: buttons on the title line (outside the tap area, so they don't open or close the card), e.g. Staff's +.
// count: shown in brackets, (165) or (33 Active).
export type MemberCard = {
  key: string;
  title: string;
  count?: ReactNode;
  alert?: boolean;
  action?: ReactNode;
  body: ReactNode;
};

// Members on every organization (Thunder and each one, the same): the title, then one card per part this person may see
// and the organization has the feature for (Requests while someone waits, Staff, Coaches, Players, Families). Cards open
// and close on their own (any number open at once); each part loads in the background so the page shows at once.
// `open`: the card a link asked for (e.g. /members/coaches).
export default function MembersCards({
  cards,
  open,
  heading = "Members",
}: {
  cards: MemberCard[];
  open: string | null;
  heading?: string | null; // the page title (none on Home, where the cards sit under the welcome line)
}) {
  return (
    <>
      {heading && <h1 className="mb-4 text-2xl font-semibold tracking-tight">{heading}</h1>}
      {!cards.length && <p className="text-sm text-zinc-500">Nothing here for you yet.</p>}
      <div className="space-y-3">
        {cards.map((c) => (
          <div key={c.key} className="relative">
          <details id={c.key} className={`${card} group overflow-hidden`} open={c.key === open}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
              <span className={`text-lg font-semibold ${c.action ? "pr-16" : ""} ${c.alert ? "animate-pulse text-red-600 dark:text-red-400" : ""}`}>{c.title}
                {c.count !== undefined && c.count !== null && <span className="font-normal text-zinc-500"> ({c.count})</span>}
              </span>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
                className="size-5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </summary>
            {/* The part's own title is the card's, so its big heading is kept for screen readers only. */}
            <div className="border-t border-zinc-100 p-3 sm:p-4 dark:border-white/5 [&_h1]:sr-only">
              <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>{c.body}</Suspense>
            </div>
          </details>
          {c.action && <div className="absolute top-2 right-11">{c.action}</div>}
          {/* A page shown in this card can put its own buttons here (PageMenus slot), e.g. Teams' 📣 and +. */}
          {!c.action && <div id={`card-slot-${c.key}`} className="absolute top-1.5 right-11 flex items-center gap-2 empty:hidden" />}
          </div>
        ))}
      </div>
    </>
  );
}
