"use client";

import { useState, useTransition, type ReactNode } from "react";
import SubCard from "../../../SubCard";
import { GymGear, OrgGymMenu } from "../../../GymMenu";
import GymPlace from "../../../GymPlace";
import { useRouter } from "next/navigation";
import { addOrgGym, setGymLocation, setGymPinLocation } from "../../thunder/facilities/actions";
import PinFields, { NO_PIN, type PinInput } from "../../../PinFields";
import PlaceSearch from "../../../PlaceSearch";
import { Alert, PopUp, Toast } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";
import ImportGymsButton from "../../../ImportGyms";

type Gym = {
  id: string;
  name: string;
  short: string | null;
  courts: string[];
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  pinLat?: number | null;
  pinLng?: number | null;
  pinAddress?: string | null;
};

// A registered organization's gyms: the list, + Add at the top right (a pop-up: name, short name, courts by name), and
// Remove on each (asks first).
// `calendars`: each gym's availability calendar by its id, shown inside that gym's card.
// `tools`: false when Import and + Add sit on the Gyms card's title line instead.
export default function OrgGyms({
  org,
  gyms,
  calendars,
  tools = true,
}: {
  org: string;
  gyms: Gym[];
  calendars?: Record<string, ReactNode>;
  tools?: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {tools && (
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Gyms</h2>
          <p className="text-sm text-zinc-500">
            The gyms where you can host games. The short name shows where space is tight, like on a phone schedule.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ImportGymsButton org={org} />
          <PopUp
            label="+ Add"
            title="Add gym"
            className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
          >
            {(close) => (
              <AddGymForm
                org={org}
                onAdded={(name) => {
                  close();
                  setMsg(`${name} added.`);
                  router.refresh();
                }}
              />
            )}
          </PopUp>
        </div>
      </div>
      )}
      {/* Each gym a card that opens right here: its courts and its availability. */}
      <div className="space-y-2">
        {gyms.map((g) => (
          <SubCard
            key={g.id}
            title={g.short ? `${g.name} (${g.short})` : g.name}
            count={`${g.courts.length} court${g.courts.length === 1 ? "" : "s"}`}
            action={<GymGear gymId={g.id} name={g.name} />}
          >
            {/* The ⚙ opens the gym's menu here: Name, Location, Directions pin, Delete gym (asks first). */}
            <OrgGymMenu org={org} gymId={g.id} name={g.name} short={g.short} address={g.address ?? null} pinAddress={g.pinAddress ?? null} />
            <GymPlace gym={g} />
            <p className="text-xs text-zinc-500">{g.courts.join(", ")}</p>
            {calendars?.[g.id] && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold">Availability</p>
                {calendars[g.id]}
              </div>
            )}
          </SubCard>
        ))}
        {!gyms.length && <p className="text-sm text-zinc-500">No gyms yet. Tap + Add.</p>}
      </div>
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}

const courtName = (i: number) => (i === 0 ? "Main" : i === 1 ? "Aux" : `Court ${i + 1}`);

// The pop-up's form. Courts start as Main, Aux, Court 3…; changing the number keeps the names typed so far.
export function AddGymForm({ org, onAdded }: { org: string; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [place, setPlace] = useState<{ placeId: string; address: string; session: string } | null>(null); // its real place
  const [byHand, setByHand] = useState(false); // or a pin from Google Maps and the address
  const [pin, setPin] = useState<PinInput>(NO_PIN);
  const [courts, setCourts] = useState(["Main"]);
  const setCount = (n: number) =>
    setCourts((c) => Array.from({ length: Math.min(12, Math.max(1, n || 1)) }, (_, i) => c[i] ?? courtName(i)));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addOrgGym(org, { name, short, courts: courts.map((c) => c.trim()) });
          if (!r.ok) return setError(r.message);
          // Then its location (the place picked from the search), when one was picked.
          // Then its Google place and its Directions pin, each when given.
          if ("id" in r && place) {
            const at = await setGymLocation(org, String(r.id), place.placeId, place.session);
            if (!at.ok) return setError(`${name} was added, but its location wasn't saved: ${at.message}`);
          }
          if ("id" in r && byHand && pin.pin.trim()) {
            const at = await setGymPinLocation(org, String(r.id), pin.pin, pin.address);
            if (!at.ok) return setError(`${name} was added, but its pin wasn't saved: ${at.message}`);
          }
          onAdded(name);
        });
      }}
    >
      <div className="space-y-1">
        <span className={fieldLabel}>Find the gym</span>
        <PlaceSearch
          org={org}
          onPick={(hit, session) => {
            setName(hit.name);
            setPlace({ placeId: hit.placeId, address: hit.address, session });
          }}
        />
        {place && <p className="text-xs text-zinc-500">📍 {place.address}</p>}
        <button type="button" onClick={() => setByHand(!byHand)} className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400">
          {byHand ? "Hide the Directions pin" : "Add a Directions pin (optional: the right door or parking lot)"}
        </button>
        {byHand && <PinFields value={pin} onChange={setPin} />}
      </div>
      {/* Laid out like Thunder's Add gym: name and how many courts, then the courts' names. */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className={fieldLabel}>Gym name</span>
          <input
            className={inputCls}
            placeholder="e.g. East Ridge Community Center"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Courts</span>
          <select className={inputCls} value={courts.length} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Short name</span>
        <input
          className={inputCls}
          placeholder="e.g. ERCC (up to 8 letters or numbers)"
          maxLength={8}
          value={short}
          onChange={(e) => setShort(e.target.value)}
          required
        />
      </label>
      <div className="space-y-2">
        <span className={fieldLabel}>Court names</span>
        {courts.map((c, i) => (
          <input
            key={i}
            className={inputCls}
            maxLength={60}
            value={c}
            aria-label={`Court ${i + 1} name`}
            onChange={(e) => setCourts((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
            required
          />
        ))}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add gym"}
      </button>
    </form>
  );
}
