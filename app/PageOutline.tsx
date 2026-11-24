import { card } from "./ui";

// What shows the moment a page is tapped, while it loads: the header's bar and cards' shapes, in the places the real ones
// take. Says nothing (read out as "Loading").
const bar = "rounded bg-zinc-200 dark:bg-zinc-800";

export function HeaderOutline() {
  return (
    <div aria-hidden className="border-t-[3px] border-b border-zinc-950/5 border-t-zinc-300 dark:border-white/10 dark:border-t-zinc-700">
      <div className="mx-auto flex max-w-3xl animate-pulse items-center justify-between gap-3 px-4 py-3 lg:max-w-6xl">
        <div className="flex items-center gap-2">
          <div className={`${bar} size-9 rounded-md`} />
          <div className={`${bar} h-4 w-32`} />
        </div>
        <div className={`${bar} size-8 rounded-full`} />
      </div>
      <div className="mx-auto max-w-3xl animate-pulse px-4 pb-3 lg:max-w-6xl">
        <div className={`${bar} h-6 w-24 rounded-full`} />
      </div>
    </div>
  );
}

export function CardsOutline({ n = 5 }: { n?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid animate-pulse items-start gap-3 lg:grid-cols-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`${card} px-4 py-4`}>
          <div className={`${bar} h-5`} style={{ width: `${[45, 30, 55, 35, 40, 50][i % 6]}%` }} />
        </div>
      ))}
    </div>
  );
}

// A team's page: its own card (name, level), then the rest.
export function TeamOutline() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 py-6 lg:max-w-6xl">
      <div aria-hidden className={`${card} animate-pulse space-y-3 p-5`}>
        <div className={`${bar} h-6 w-2/5`} />
        <div className={`${bar} h-4 w-1/4`} />
      </div>
      <CardsOutline n={6} />
    </main>
  );
}

export default function PageOutline() {
  return (
    <>
      <HeaderOutline />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 lg:max-w-6xl">
        <CardsOutline />
      </main>
    </>
  );
}
