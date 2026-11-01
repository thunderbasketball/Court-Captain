// A team with no coaches: flashes red until one is added.
export function NeedsCoach() {
  return <span className="block animate-pulse text-sm font-semibold text-red-600 dark:text-red-400">Please add coach info</span>;
}
