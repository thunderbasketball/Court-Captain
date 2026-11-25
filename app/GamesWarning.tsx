import { Alert } from "./client-ui";

// Before a team's grade, level or gender is changed: the games that will need correcting.
export default function GamesWarning({ games }: { games: string[] }) {
  return (
    <Alert tone="red">
      <span className="block font-semibold">
        ⚠ This team has {games.length} game{games.length === 1 ? "" : "s"} that will need correcting
      </span>
      {games.map((g, i) => (
        <span key={i} className="block">
          {g}
        </span>
      ))}
      <span className="mt-1 block">It moves to its new division now. The League&apos;s schedulers are warned until each game is corrected.</span>
    </Alert>
  );
}
