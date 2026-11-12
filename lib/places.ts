// Gym locations (SPEC.md section 14, Facilities): a gym is a real place picked from Google Places (New). Searches and
// details are asked from the server only, with GOOGLE_PLACES_API_KEY (.env.local; never sent to the browser). Only the
// typed text goes to Google; no personal information. A search and the pick share a session token (Google bills them
// as one). Results lean toward the Chattanooga area.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea, orgHasArea } from "./org-admin";
import { isOrgSlug } from "./orgs";
import type { Queryable } from "./sql";

type Fetch = typeof fetch;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type PlaceHit = { placeId: string; name: string; address: string };
export type Place = PlaceHit & { lat: number; lng: number };

const API = "https://places.googleapis.com/v1";
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const SESSION = /^[A-Za-z0-9-]{8,64}$/;
const CHATTANOOGA = { latitude: 35.0456, longitude: -85.3097 };
const NOT_SET_UP = "Location search isn't set up yet.";

const key = () => process.env.GOOGLE_PLACES_API_KEY ?? "";
export const placesOn = () => !!key();

// Who may set an organization's gym locations: Thunder's Directors of Facilities or Practices; another organization's
// Admins and Directors of Facilities.
export async function managesGyms(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  if (!isOrgSlug(org)) return false;
  return org === "thunder" ? hasArea(viewer, "facilities", "practices") : orgHasArea(q, viewer.coachId, org, "facilities");
}

// Places matching what's typed (3+ letters), nearest Chattanooga first.
export async function suggestPlaces(text: unknown, session: unknown, f: Fetch = fetch): Promise<Result<{ hits: PlaceHit[] }>> {
  if (!placesOn()) return { ok: false, message: NOT_SET_UP };
  const input = typeof text === "string" ? text.trim().slice(0, 100) : "";
  if (input.length < 3) return { ok: true, hits: [] };
  if (typeof session !== "string" || !SESSION.test(session)) return { ok: false, message: "Search again." };
  const r = await f(`${API}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key() },
    body: JSON.stringify({
      input,
      sessionToken: session,
      includedRegionCodes: ["us"],
      locationBias: { circle: { center: CHATTANOOGA, radius: 50000 } },
    }),
  });
  if (!r.ok) {
    console.error("Places search failed:", r.status);
    return { ok: false, message: "Location search isn't working right now. Try again later." };
  }
  const data = (await r.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[];
  };
  const hits = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId && PLACE_ID.test(p.placeId))
    .map((p) => ({ placeId: p.placeId!, name: p.structuredFormat?.mainText?.text ?? "", address: p.structuredFormat?.secondaryText?.text ?? "" }))
    .filter((p) => p.name)
    .slice(0, 6);
  return { ok: true, hits };
}

// One place's name, full address and map location.
export async function placeDetails(placeId: string, session: string | null, f: Fetch = fetch): Promise<Place | null> {
  if (!placesOn() || !PLACE_ID.test(placeId)) return null;
  const qs = session && SESSION.test(session) ? `?sessionToken=${encodeURIComponent(session)}` : "";
  const r = await f(`${API}/places/${encodeURIComponent(placeId)}${qs}`, {
    headers: { "X-Goog-Api-Key": key(), "X-Goog-FieldMask": "id,displayName,formattedAddress,location" },
  });
  if (!r.ok) {
    console.error("Place details failed:", r.status);
    return null;
  }
  const d = (await r.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  };
  const lat = d.location?.latitude;
  const lng = d.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !d.formattedAddress) return null;
  return {
    placeId: d.id && PLACE_ID.test(d.id) ? d.id : placeId,
    name: (d.displayName?.text ?? "").slice(0, 100),
    address: d.formattedAddress.slice(0, 200),
    lat,
    lng,
  };
}

// Set (placeId) or clear (null) a gym's location. The address and map spot come from Google, never from the browser.
export async function setGymPlace(
  deps: { pool: Pool; now: () => Date; fetch?: Fetch },
  viewer: SessionUser,
  org: unknown,
  gymId: unknown,
  placeId: unknown,
  session: unknown = null,
): Promise<Result<{ address: string | null }>> {
  if (typeof org !== "string" || !(await managesGyms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can set gym locations." };
  if (typeof gymId !== "string" || !/^\d{1,18}$/.test(gymId)) return { ok: false, message: "That gym no longer exists." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  if (placeId === null) {
    const r = await deps.pool.query(
      `update gyms set address = null, lat = null, lng = null, place_id = null, place_set_by = $3, place_set_at = $4
       where id = $1 and org = $2`,
      [gymId, org, by, deps.now()],
    );
    return r.rowCount ? { ok: true, address: null } : { ok: false, message: "That gym no longer exists." };
  }
  if (typeof placeId !== "string" || !PLACE_ID.test(placeId)) return { ok: false, message: "Pick a place from the list." };
  if (!placesOn()) return { ok: false, message: NOT_SET_UP };
  const p = await placeDetails(placeId, typeof session === "string" ? session : null, deps.fetch ?? fetch);
  if (!p) return { ok: false, message: "That place couldn't be found. Search again." };
  const r = await deps.pool.query(
    `update gyms set address = $3, lat = $4, lng = $5, place_id = $6, place_set_by = $7, place_set_at = $8
     where id = $1 and org = $2`,
    [gymId, org, p.address, p.lat, p.lng, p.placeId, by, deps.now()],
  );
  return r.rowCount ? { ok: true, address: p.address } : { ok: false, message: "That gym no longer exists." };
}

// ---- Set by hand: a pin copied from Google Maps, and the address typed ----

const MAPS_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.google.com", "google.com", "maps.google.com"]);

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// A pin in text: "35.0312, -85.2701", or a Google Maps link with the pin (!3d…!4d…), its spot (@lat,lng) or ?q=/ll=lat,lng.
export function pinFrom(text: string): { lat: number; lng: number } | null {
  const num = "(-?\\d{1,3}\\.\\d+)";
  const tries = [
    new RegExp(`!3d${num}!4d${num}`), // the dropped pin itself
    new RegExp(`[?&](?:q|ll|query|destination)=${num},\\s*${num}`),
    new RegExp(`@${num},${num}`), // where the map was looking
    new RegExp(`^\\s*${num}\\s*,\\s*${num}\\s*$`), // just the numbers
  ];
  const t = decodeURIComponent(text.replace(/\+/g, " "));
  for (const re of tries) {
    const m = t.match(re);
    if (m && inRange(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

// Read a pasted pin: the numbers, a full Google Maps link, or a short share link (maps.app.goo.gl), which is opened
// (Google's own links only, up to 4 hops) to find where it leads.
export async function readPin(input: unknown, f: Fetch = fetch): Promise<{ lat: number; lng: number } | null> {
  const text = typeof input === "string" ? input.trim().slice(0, 2000) : "";
  if (!text) return null;
  const direct = pinFrom(text);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" || !MAPS_HOSTS.has(url.hostname)) return null;
    const r = await f(url.toString(), { redirect: "manual" });
    const next = r.headers.get("location");
    if (!next) return pinFrom(url.toString());
    url = new URL(next, url);
    const found = pinFrom(url.toString());
    if (found) return found;
  }
  return null;
}

// Set a gym's pin by hand (Directions go there): the pin pasted and its address typed. The Google place, if any, stays
// (its address is the one shown). `input` null removes the pin.
export async function setGymPin(
  deps: { pool: Pool; now: () => Date; fetch?: Fetch },
  viewer: SessionUser,
  org: unknown,
  gymId: unknown,
  input: { pin: unknown; address: unknown } | null,
): Promise<Result<{ address: string | null }>> {
  if (typeof org !== "string" || !(await managesGyms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can set gym locations." };
  if (typeof gymId !== "string" || !/^\d{1,18}$/.test(gymId)) return { ok: false, message: "That gym no longer exists." };
  if (input === null) {
    const r = await deps.pool.query(
      `update gyms set pin_lat = null, pin_lng = null, pin_address = null, pin_set_by = $3, pin_set_at = $4
       where id = $1 and org = $2`,
      [gymId, org, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    return r.rowCount ? { ok: true, address: null } : { ok: false, message: "That gym no longer exists." };
  }
  const address = typeof input.address === "string" ? input.address.trim().replace(/\s+/g, " ") : "";
  if (address.length < 5 || address.length > 200) return { ok: false, message: "Type the gym's address (5 to 200 letters)." };
  const pin = await readPin(input.pin, deps.fetch ?? fetch);
  if (!pin)
    return {
      ok: false,
      message: "That pin couldn't be read. In Google Maps, drop a pin and copy the numbers (like 35.0312, -85.2701) or Share → Copy link.",
    };
  const r = await deps.pool.query(
    `update gyms set pin_address = $3, pin_lat = $4, pin_lng = $5, pin_set_by = $6, pin_set_at = $7
     where id = $1 and org = $2`,
    [gymId, org, address, pin.lat, pin.lng, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return r.rowCount ? { ok: true, address } : { ok: false, message: "That gym no longer exists." };
}

// ---- A CourtSync Scheduler's own pin for a gym its games use ----

const GYM_KEY = /^[op]\d{1,18}$/;

// Set (input) or remove (null) the Scheduler's pin for a host's gym ('o<id>') or a gym it typed in ('p<id>'): its own
// schedules' Directions go there instead of the host's location. The Scheduler's Admins and Directors of Facilities.
export async function setSchedulerPin(
  deps: { pool: Pool; now: () => Date; fetch?: Fetch },
  viewer: SessionUser,
  org: string,
  gymKey: unknown,
  input: { pin: unknown; label: unknown } | null,
): Promise<Result<{ label: string | null }>> {
  if (!isOrgSlug(org) || !(await orgHasArea(deps.pool, viewer.coachId, org, "facilities")))
    return { ok: false, message: "Only an Admin or Director of Facilities can set pins." };
  if (typeof gymKey !== "string" || !GYM_KEY.test(gymKey)) return { ok: false, message: "That gym no longer exists." };
  const id = gymKey.slice(1);
  const there = await deps.pool.query(
    gymKey[0] === "o"
      ? "select 1 from gyms g join partners p on p.org_slug = g.org and p.approved and p.hosts_games where g.id = $1"
      : "select 1 from partner_gyms where id = $1",
    [id],
  );
  if (!there.rowCount) return { ok: false, message: "That gym no longer exists." };
  if (input === null) {
    await deps.pool.query("delete from scheduler_gym_pins where org = $1 and gym_key = $2", [org, gymKey]);
    return { ok: true, label: null };
  }
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ") : "";
  if (label.length < 3 || label.length > 200) return { ok: false, message: "Say what the pin is (3 to 200 letters), like the address or \"Back gym door\"." };
  const pin = await readPin(input.pin, deps.fetch ?? fetch);
  if (!pin)
    return {
      ok: false,
      message: "That pin couldn't be read. In Google Maps, drop a pin and copy the numbers (like 35.0312, -85.2701) or Share → Copy link.",
    };
  await deps.pool.query(
    `insert into scheduler_gym_pins (org, gym_key, pin_lat, pin_lng, label, set_by, set_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (org, gym_key) do update set pin_lat = $3, pin_lng = $4, label = $5, set_by = $6, set_at = $7`,
    [org, gymKey, pin.lat, pin.lng, label, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return { ok: true, label };
}
