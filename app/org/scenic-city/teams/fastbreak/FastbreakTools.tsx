"use client";

// The FastBreak page's buttons: Sync now (shows what it did) and Change (what a Fastbreak organization is here).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FastbreakReport } from "@/lib/fastbreak/sync";
import { setFastbreakOrg, syncFastbreakNow } from "../../actions";
import { Alert, PopUp } from "../../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../../ui";

export function SyncNowButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FastbreakReport | null>(null);
  const run = () =>
    start(async () => {
      setError(null);
      setReport(null);
      const r = await syncFastbreakNow();
      if (!r.ok) return setError(r.message);
      setReport(r.report);
      router.refresh();
    });
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <p className="font-semibold">
          {title} ({items.length})
        </p>
        <ul className="list-disc pl-5">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {busy ? "Syncing… (about 10 seconds)" : "Sync now"}
      </button>
      {error && <Alert tone="red">{error}</Alert>}
      {report && (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5">
          {!report.added.length && !report.registered.length && !report.problems.length && (
            <p>Nothing new. Everything from FastBreak is already here.</p>
          )}
          {list("Teams added", report.added)}
          {list("Dates registered", report.registered)}
          {list(
            "Waiting for you to pick their club",
            report.waiting.map((o) => `${o.org}: ${o.teams} team${o.teams === 1 ? "" : "s"}`),
          )}
          {list("Problems", report.problems)}
        </div>
      )}
    </div>
  );
}

type Club = { id: string; name: string; abbr: string };

export function OrgPicker({
  id,
  fbName,
  kind,
  clubId,
  suggested,
  clubs,
}: {
  id: string;
  fbName: string;
  kind: "waiting" | "skip" | "club";
  clubId: string | null;
  suggested: string;
  clubs: Club[];
}) {
  return (
    <PopUp label={kind === "waiting" ? "Pick club" : "Change"} title={fbName}>
      {(close) => <PickForm {...{ id, kind, clubId, suggested, clubs, close }} />}
    </PopUp>
  );
}

function PickForm({
  id,
  kind,
  clubId,
  suggested,
  clubs,
  close,
}: {
  id: string;
  kind: "waiting" | "skip" | "club";
  clubId: string | null;
  suggested: string;
  clubs: Club[];
  close: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // "new", "skip", "waiting", or a club's id.
  const [pick, setPick] = useState(kind === "club" && clubId ? clubId : kind === "skip" ? "skip" : clubs.length ? "" : "new");
  const [name, setName] = useState(suggested);
  const [abbr, setAbbr] = useState("");
  const save = () =>
    start(async () => {
      setError(null);
      if (!pick) return setError("Pick one.");
      const r = await setFastbreakOrg(id, pick === "new" ? { name, abbr } : pick);
      if (!r.ok) return setError(r.message);
      close();
      router.refresh();
    });
  return (
    <div className="space-y-4">
      <div>
        <label className={fieldLabel} htmlFor={`fb-pick-${id}`}>
          What is it here?
        </label>
        <select id={`fb-pick-${id}`} className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="" disabled>
            Pick…
          </option>
          <option value="new">A new outside club</option>
          {clubs.length > 0 && (
            <optgroup label="Outside clubs already here">
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.abbr})
                </option>
              ))}
            </optgroup>
          )}
          <option value="skip">On CourtCaptain (they add their own teams; skip these)</option>
          <option value="waiting">Not sure yet (their teams wait)</option>
        </select>
      </div>
      {pick === "new" && (
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <div>
            <label className={fieldLabel} htmlFor={`fb-name-${id}`}>
              Club name
            </label>
            <input
              id={`fb-name-${id}`}
              className={inputCls}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`fb-abbr-${id}`}>
              Abbreviation
            </label>
            <input
              id={`fb-abbr-${id}`}
              className={inputCls}
              value={abbr}
              maxLength={6}
              placeholder="Initials"
              onChange={(e) => setAbbr(e.target.value.toUpperCase())}
            />
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Teams are added at the next sync, named with the club&apos;s Abbreviation and (FB). Teams already added stay as they are.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
