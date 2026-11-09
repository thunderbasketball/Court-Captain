import type { ReactNode } from "react";

// A Recent import or Register all line that opens (tap it) to list the teams it included.
export default function TeamsIncluded({ summary, names }: { summary: ReactNode; names: string[] }) {
  return (
    <details className="group min-w-0 flex-1">
      <summary className="flex cursor-pointer list-none items-start gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className="mt-px inline-block shrink-0 text-zinc-400 transition-transform group-open:rotate-90">›</span>
        <span className="min-w-0">{summary}</span>
      </summary>
      <ul className="mt-1.5 mb-1 ml-4 flex flex-wrap gap-1.5">
        {names.map((n, i) => (
          <li key={`${n}-${i}`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {n}
          </li>
        ))}
      </ul>
    </details>
  );
}
