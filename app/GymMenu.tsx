"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeGymPin, removeOrgGym, renameGym, setGymLocation, setGymPinLocation } from "./org/thunder/facilities/actions";
import PinFields, { NO_PIN, type PinInput } from "./PinFields";
import PlaceSearch from "./PlaceSearch";
import { deleteGym } from "./org/thunder/practice/actions";
import { CardPanel, PanelIcon, iconBtn } from "./CardIcons";
import { GearIcon } from "./OrgSettings";

const menuId = (gymId: string) => `gym-menu-${gymId}`;

// A gym card's ⚙ (top right of its card): opens the gym's menu right in the card.
export function GymGear({ gymId, name }: { gymId: string; name: string }) {
  return (
    <PanelIcon id={menuId(gymId)} label={`${name} settings`} className={iconBtn}>
      <GearIcon className="size-5" />
    </PanelIcon>
  );
}

// The gym's menu: Name (and short name), Location (find the real place, or change or remove it), then Delete gym, which asks right here first
// ("Delete Action Church?" · Keep it · Delete gym).
function GymMenu({
  org,
  gymId,
  name,
  short,
  address,
  pinAddress,
  note,
  run,
}: {
  org: string;
  gymId: string;
  name: string;
  short?: string | null; // another organization's gyms have a short name; Thunder's don't (undefined: no field)
  address: string | null;
  pinAddress: string | null; // the hand-set pin's address (Directions go there)
  note: string;
  run: () => Promise<{ ok: true; text: string } | { ok: false; message: string }>;
}) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [newName, setNewName] = useState(name);
  const [newShort, setNewShort] = useState(short ?? "");
  const nameChanged = newName.trim() !== name || (short !== undefined && newShort.trim() !== (short ?? ""));
  const [byHand, setByHand] = useState(false); // set the location by hand: a pin from Google Maps and the address
  const [pin, setPin] = useState<PinInput>(NO_PIN);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <CardPanel id={menuId(gymId)} className="mb-3 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await renameGym(org, gymId, short === undefined ? { name: newName } : { name: newName, short: newShort });
            setMsg(r.ok ? { ok: true, text: `Renamed: ${r.name}` } : { ok: false, text: r.message });
            if (r.ok) router.refresh();
          });
        }}
      >
        <p className="text-sm font-semibold">Name</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            aria-label="Gym name"
            className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
          />
          {short !== undefined && (
            <input
              value={newShort}
              onChange={(e) => setNewShort(e.target.value)}
              maxLength={8}
              aria-label="Short name"
              placeholder="Short"
              className="w-24 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
            />
          )}
        </div>
        {nameChanged && (
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save name
          </button>
        )}
      </form>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Location</p>
        <p className="text-xs text-zinc-500">{address ?? "Not set yet: search for the gym to attach its Google address."}</p>
        <PlaceSearch
          org={org}
          placeholder={address ? "Search to change it…" : undefined}
          onPick={(hit, session) =>
            start(async () => {
              const r = await setGymLocation(org, gymId, hit.placeId, session);
              setMsg(r.ok ? { ok: true, text: `Location set: ${r.address}` } : { ok: false, text: r.message });
              if (r.ok) router.refresh();
            })
          }
        />
        {address && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await setGymLocation(org, gymId, null, null);
                setMsg(r.ok ? { ok: true, text: "Google location removed." } : { ok: false, text: r.message });
                if (r.ok) router.refresh();
              })
            }
            className="text-xs font-medium text-zinc-500 hover:underline"
          >
            Remove Google location
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Directions pin</p>
        <p className="text-xs text-zinc-500">
          {pinAddress
            ? `Directions go to your pin: ${pinAddress}`
            : "Directions go to the Google location. Set a pin by hand for the right door or parking lot."}
        </p>
        <span className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setByHand(!byHand)} className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400">
            {byHand ? "Hide" : pinAddress ? "Change the pin" : "Set it by hand"}
          </button>
          {pinAddress && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await removeGymPin(org, gymId);
                  setMsg(r.ok ? { ok: true, text: "Pin removed." } : { ok: false, text: r.message });
                  if (r.ok) router.refresh();
                })
              }
              className="text-xs font-medium text-zinc-500 hover:underline"
            >
              Remove pin
            </button>
          )}
        </span>
        {byHand && (
          <div className="space-y-2 rounded-lg bg-white p-2 ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <PinFields value={pin} onChange={setPin} />
            <button
              type="button"
              disabled={busy || !pin.pin.trim() || !pin.address.trim()}
              onClick={() =>
                start(async () => {
                  const r = await setGymPinLocation(org, gymId, pin.pin, pin.address);
                  setMsg(r.ok ? { ok: true, text: `Pin set: ${r.address}` } : { ok: false, text: r.message });
                  if (r.ok) {
                    setPin(NO_PIN);
                    setByHand(false);
                    router.refresh();
                  }
                })
              }
              className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save pin
            </button>
          </div>
        )}
      </div>
      {sure ? (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-semibold">Delete {name}?</span> {note} This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSure(false)} className="rounded-full px-3 py-1.5 ring-1 ring-zinc-950/10 dark:ring-white/15">
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await run();
                  setSure(false);
                  setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.message });
                  if (r.ok) router.refresh();
                })
              }
              className="rounded-full bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete gym"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setSure(true)} className="text-sm font-medium text-red-600 dark:text-red-400">
          Delete gym
        </button>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </CardPanel>
  );
}

// Thunder's gyms: the server refuses while a gym has upcoming booked practices, and keeps one with past practices (hidden).
export function ThunderGymMenu({
  gymId,
  name,
  openSlots,
  address,
  pinAddress,
}: {
  gymId: string;
  name: string;
  openSlots: number;
  address: string | null;
  pinAddress: string | null;
}) {
  return (
    <GymMenu
      org="thunder"
      address={address}
      pinAddress={pinAddress}
      gymId={gymId}
      name={name}
      note={openSlots ? `Its ${openSlots} upcoming open slot${openSlots === 1 ? "" : "s"} go too.` : ""}
      run={async () => {
        const r = await deleteGym(gymId);
        return r.ok ? { ok: true, text: r.kept ? `${name} removed (kept for its past practices).` : `${name} deleted.` } : r;
      }}
    />
  );
}

// Another organization's gyms: its courts and availability go with it.
export function OrgGymMenu({
  org,
  gymId,
  name,
  short,
  address,
  pinAddress,
}: {
  org: string;
  gymId: string;
  name: string;
  short: string | null;
  address: string | null;
  pinAddress: string | null;
}) {
  return (
    <GymMenu
      org={org}
      short={short}
      address={address}
      pinAddress={pinAddress}
      gymId={gymId}
      name={name}
      note="Its courts and availability go with it."
      run={async () => {
        const r = await removeOrgGym(org, gymId);
        return r.ok ? { ok: true, text: `${name} removed.` } : r;
      }}
    />
  );
}
