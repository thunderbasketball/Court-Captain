"use client";

import PlaceSearch from "../../../PlaceSearch";
import { setGymLocation, setGymPinLocation } from "../facilities/actions";
import PinFields, { NO_PIN, type PinInput } from "../../../PinFields";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { repeatOptions, ruleStart, type RuleKind, type RuleSpec } from "@/lib/practice/rule-dates";
import type { GymWithCourts } from "@/lib/practice/schedule";
import { addGym, blackoutDates } from "./actions";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../ui";

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// A button that opens a pop-up with a title and a form; `onSubmit` returns an error message or a success message.
function ToolDialog({
  label,
  title,
  tone = "blue",
  submitLabel,
  canSubmit,
  onOpen,
  beforeSubmit,
  onSubmit,
  children,
  inline = false,
}: {
  inline?: boolean; // the form right where it's put (a card's panel), no button or pop-up
  label: string;
  title: string;
  tone?: "blue" | "red";
  submitLabel: string;
  canSubmit: boolean;
  onOpen?: () => void;
  beforeSubmit?: () => Promise<boolean>; // e.g. an "are you sure?" box; runs before any work starts
  onSubmit: () => Promise<{ error?: string; done?: string }>;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const form = (
    <form
      className={inline ? "space-y-3" : "space-y-4 p-5"}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (beforeSubmit && !(await beforeSubmit())) return;
        start(async () => {
          const r = await onSubmit();
          if (r.error) return setError(r.error);
          close();
          if (inline) onOpen?.();
          setDone(r.done ?? "Done.");
          router.refresh();
        });
      }}
    >
      {inline ? (
        <p className="text-sm font-semibold">{title}</p>
      ) : (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <CloseButton onClick={close} />
        </div>
      )}
      {children}
      {error && <Alert tone="red">{error}</Alert>}
      <button
        type="submit"
        disabled={busy || !canSubmit}
        className={tone === "red" ? `${primaryBtn} !bg-red-600 hover:!bg-red-700` : primaryBtn}
      >
        {busy ? "Working…" : submitLabel}
      </button>
    </form>
  );
  if (inline)
    return (
      <>
        {form}
        {done && <Toast key={done} message={done} />}
      </>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          onOpen?.();
          dialog.current?.showModal();
        }}
        className={
          tone === "red"
            ? "rounded-full px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            : "rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
        }
      >
        {label}
      </button>
      {done && <Toast key={done} message={done} />}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        {form}
      </dialog>
    </>
  );
}

function GymSelect({
  gyms,
  value,
  onChange,
  allLabel,
}: {
  gyms: GymWithCourts[];
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {allLabel && <option value="all">{allLabel}</option>}
      {!allLabel && <option value="">Choose…</option>}
      {gyms.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function DateRange({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className={fieldLabel}>From</span>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="block">
        <span className={fieldLabel}>To</span>
        <input type="date" className={inputCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </label>
    </div>
  );
}

export function AddGymButton({ inline = false }: { inline?: boolean } = {}) {
  const [name, setName] = useState("");
  const [place, setPlace] = useState<{ placeId: string; address: string; session: string } | null>(null); // its real place
  const [byHand, setByHand] = useState(false); // or a pin from Google Maps and the address
  const [pin, setPin] = useState<PinInput>(NO_PIN);
  const [courts, setCourts] = useState(["Court 1", "Court 2"]);
  const setCount = (n: number) => setCourts((c) => Array.from({ length: n }, (_, i) => c[i] ?? `Court ${i + 1}`));
  return (
    <ToolDialog
      inline={inline}
      label="+ Add"
      title="Add gym"
      submitLabel="Add gym"
      canSubmit={!!name.trim() && courts.every((c) => c.trim())}
      onOpen={() => {
        setName("");
        setPlace(null);
        setByHand(false);
        setPin(NO_PIN);
        setCourts(["Court 1", "Court 2"]);
      }}
      onSubmit={async () => {
        const r = await addGym({ name, courts });
        if (!r.ok) return { error: r.message };
        // Then its location (the place picked from the search), when one was picked.
        // Then its Google place and its Directions pin, each when given.
        const id = "id" in r ? String(r.id) : null;
        const atPlace = id && place ? await setGymLocation("thunder", id, place.placeId, place.session) : null;
        const atPin = id && byHand && pin.pin.trim() ? await setGymPinLocation("thunder", id, pin.pin, pin.address) : null;
        const at = atPlace && !atPlace.ok ? atPlace : atPin;
        return {
          done: `${name.trim()} added with ${courts.length} court${courts.length > 1 ? "s" : ""}${at && !at.ok ? `, but its location wasn't saved: ${at.message}` : ""}.`,
        };
      }}
    >
      <div className="space-y-1">
        <span className={fieldLabel}>Find the gym</span>
        <PlaceSearch
          org="thunder"
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
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className={fieldLabel}>Gym name</span>
          <input className={inputCls} placeholder="e.g. Heritage HS" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Courts</span>
          <select className={inputCls} value={courts.length} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <span className={fieldLabel}>Court names</span>
        {courts.map((c, i) => (
          <input
            key={i}
            className={inputCls}
            value={c}
            aria-label={`Court ${i + 1} name`}
            onChange={(e) => setCourts(courts.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
      </div>
    </ToolDialog>
  );
}

const PRESETS: { label: string; reason: string; spec: RuleSpec }[] = [
  { label: "Thanksgiving", reason: "Thanksgiving", spec: { kind: "nth", month: 11, nth: 4, weekday: 4, spanDays: 2 } },
  { label: "Christmas", reason: "Christmas", spec: { kind: "date", month: 12, day: 24, spanDays: 2 } },
  { label: "New Year's", reason: "New Years", spec: { kind: "date", month: 12, day: 31, spanDays: 2 } },
  { label: "MLK Day", reason: "MLK Day", spec: { kind: "nth", month: 1, nth: 3, weekday: 1, spanDays: 1 } },
  { label: "Memorial Day", reason: "Memorial Day", spec: { kind: "last", month: 5, weekday: 1, spanDays: 1 } },
  { label: "July 4th", reason: "Independence Day", spec: { kind: "date", month: 7, day: 4, spanDays: 1 } },
  { label: "Labor Day", reason: "Labor Day", spec: { kind: "nth", month: 9, nth: 1, weekday: 1, spanDays: 1 } },
];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const spanOf = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

// `inline`: the form right in the Blackout Dates card (its + on the title line), no button or pop-up.
export function BlackoutButton({ gyms, inline = false }: { gyms: GymWithCourts[]; inline?: boolean }) {
  const [mode, setMode] = useState<"block" | "restore">("block");
  const [gymId, setGymId] = useState("all");
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [hour, setHour] = useState<string>("all");
  const [reason, setReason] = useState("");
  const [yearly, setYearly] = useState(false);
  const [repeat, setRepeat] = useState<RuleKind>("date");
  const [confirm, confirmDialog] = useConfirm();
  const span = from && to && to >= from ? spanOf(from, to) : 1;
  const options = from ? repeatOptions(from, span) : [];
  const chosen = options.some((o) => o.kind === repeat) ? repeat : "date";

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const today = todayIso();
    const y = Number(today.slice(0, 4));
    let start = ruleStart(p.spec, y);
    if (!start || isoDay(start) < today) start = ruleStart(p.spec, y + 1);
    if (!start) return;
    setMode("block");
    setFrom(isoDay(start));
    setTo(addDays(isoDay(start), p.spec.spanDays - 1));
    setHour("all");
    setReason(p.reason);
    setYearly(true);
    setRepeat(p.spec.kind);
  };

  return (
    <>
      {confirmDialog}
      <ToolDialog
        inline={inline}
        label="Blackout dates"
        title="Blackout dates"
        tone={mode === "block" ? "red" : "blue"}
        submitLabel={mode === "block" ? (yearly ? "Block every year" : "Block dates") : "Restore dates"}
        canSubmit={!!from && !!to && (!yearly || span <= 14)}
        beforeSubmit={async () =>
          mode !== "block" ||
          confirm({
            title: yearly ? "Block these dates every year?" : "Block these dates?",
            message: (
              <p>
                Every slot in this range{yearly ? ", this year and each year after," : ""} becomes unavailable.{" "}
                <strong className="font-semibold text-red-600 dark:text-red-400">
                  Any team bookings in the range are removed.
                </strong>
              </p>
            ),
            confirmLabel: yearly ? "Block every year" : "Block dates",
          })
        }
        onSubmit={async () => {
          const r = await blackoutDates({
            mode,
            gymId,
            from,
            to,
            hour: hour === "all" ? "all" : Number(hour),
            reason,
            repeat: mode === "block" && yearly ? chosen : null,
          });
          if (!r.ok) return { error: r.message };
          if (mode === "restore") return { done: `${r.slots} slot${r.slots === 1 ? "" : "s"} reopened.` };
          const teams = [...new Set(r.removed.map((x) => x.team))];
          return {
            done: `${r.slots} slot${r.slots === 1 ? "" : "s"} blocked.${r.rule ? ` Saved: ${r.rule}.` : ""}${r.removed.length ? ` Removed ${r.removed.length} booking${r.removed.length === 1 ? "" : "s"} (${teams.join(", ")}).` : ""}`,
          };
        }}
      >
        <div className="flex gap-2">
          <button type="button" className={pillCls(mode === "block")} onClick={() => setMode("block")}>
            Block these dates
          </button>
          <button type="button" className={pillCls(mode === "restore")} onClick={() => setMode("restore")}>
            Restore (undo)
          </button>
        </div>
        {mode === "block" && (
          <div>
            <span className={fieldLabel}>Quick pick (every year)</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-600/20 ring-inset hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className={fieldLabel}>Gym</span>
          <GymSelect gyms={gyms} value={gymId} onChange={setGymId} allLabel="All gyms" />
        </label>
        <DateRange
          from={from}
          to={to}
          setFrom={(v) => {
            setFrom(v);
            if (!to || to < v) setTo(v);
          }}
          setTo={setTo}
        />
        <label className="block">
          <span className={fieldLabel}>Time</span>
          <select className={inputCls} value={hour} onChange={(e) => setHour(e.target.value)}>
            <option value="all">All day</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
        {mode === "block" && (
          <>
            <label className="block">
              <span className={fieldLabel}>Reason (optional)</span>
              <input
                className={inputCls}
                placeholder="e.g. Thanksgiving, gym closed"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/15">
              <label className="flex items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-thunder-blue"
                  checked={yearly}
                  onChange={(e) => setYearly(e.target.checked)}
                />
                Repeat every year
              </label>
              {yearly && (
                <div className="mt-2 space-y-1.5 pl-7">
                  {span > 14 ? (
                    <p className="text-xs text-red-600">A yearly blackout can cover up to 14 days.</p>
                  ) : (
                    options.map((o) => (
                      <label key={o.kind} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="repeat"
                          className="mt-0.5 accent-thunder-blue"
                          checked={chosen === o.kind}
                          onChange={() => setRepeat(o.kind)}
                        />
                        {o.label}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Blocking removes any team bookings in that range.
            </p>
          </>
        )}
      </ToolDialog>
    </>
  );
}
