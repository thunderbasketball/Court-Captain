import { directionsUrl } from "@/lib/directions";

// A gym's place on its card: the Google address (or, without one, the hand-set pin's address) and Directions, which go
// to the hand-set pin when there is one (the right door or parking lot), else to the Google place. Nothing when neither.
type Spot = {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  pinLat?: number | null;
  pinLng?: number | null;
  pinAddress?: string | null;
};

export function directionsTo(g: Spot): string | null {
  return directionsUrl(g.pinLat, g.pinLng) ?? directionsUrl(g.lat, g.lng, g.placeId);
}

export default function GymPlace({ gym }: { gym: Spot }) {
  const shown = gym.address ?? gym.pinAddress;
  const to = directionsTo(gym);
  if (!shown && !to) return null;
  return (
    <p className="mb-1 text-xs text-zinc-600 dark:text-zinc-300">
      📍 {shown ?? "Pin set"}
      {to && (
        <>
          {" · "}
          <a href={to} target="_blank" rel="noopener noreferrer" className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
            Directions
          </a>
        </>
      )}
    </p>
  );
}
