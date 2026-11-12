// " · Directions" after a game's place: opens the phone's maps (the Scheduler's pin, else the host's location).
export default function DirectionsLink({ href }: { href: string | null | undefined }) {
  if (!href) return null;
  return (
    <>
      {" · "}
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
        Directions
      </a>
    </>
  );
}
