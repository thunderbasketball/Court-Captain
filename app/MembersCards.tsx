import { Suspense, type ReactNode } from "react";
import HomeCard from "./HomeCard";

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

// A stack of cards (Home on every organization; Members inside it), the same everywhere: the title, then one card per
// part this person may see and the organization has. Cards open and close on their own (any number open at once).
// Only open cards are built: `open` is the address's list of them (`?open=teams,members` on Home, `&sub=staff` inside
// Members, `param`), so a closed card costs nothing and opening one loads just it.
export default function MembersCards({
  cards,
  open,
  heading = "Members",
  param = "open",
}: {
  cards: MemberCard[];
  open: string | null; // comma-separated card keys
  heading?: string | null; // the page title (none on Home, where the cards sit under the welcome line)
  param?: "open" | "sub";
}) {
  const opened = new Set((open ?? "").split(",").filter(Boolean));
  return (
    <>
      {heading && <h1 className="mb-4 text-2xl font-semibold tracking-tight">{heading}</h1>}
      {!cards.length && <p className="text-sm text-zinc-500">Nothing here for you yet.</p>}
      <div className="space-y-3">
        {cards.map((c) => (
          <HomeCard
            key={c.key}
            id={c.key}
            param={param}
            title={c.title}
            count={c.count}
            alert={c.alert}
            action={c.action}
            open={opened.has(c.key)}
          >
            {opened.has(c.key) && <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>{c.body}</Suspense>}
          </HomeCard>
        ))}
      </div>
    </>
  );
}
