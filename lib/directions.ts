// A Directions link (opens the phone's maps): to a spot, with Google's place when it's that place's own spot.
export function directionsUrl(lat: number | null | undefined, lng: number | null | undefined, placeId?: string | null): string | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ""}`;
}
