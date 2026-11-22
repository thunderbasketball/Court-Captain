"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PriceGroup } from "@/lib/scenic-programs";
import { deletePriceGroup, savePriceGroup, tagOrgs } from "../actions";
import { Toast } from "../../../client-ui";
import { useTouchDrag } from "../../../touch-drag";
import SubCard from "../../../SubCard";

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));
const NONE = "none";

// In a League's Fees (Directors of Programs): named price groups. Each group's name is the tag its organizations get,
// with an ALL Season price per team (blank: the League's) and Pay later (its teams register without paying by card;
// Scenic City's Owners mark them Paid). Organizations start untagged at the standard price. Drag an organization into a
// group to tag it (on a phone: press and hold, then slide; or tap it, then tap the group); drag it to Standard to untag
// it. The round + adds a group; a group's Edit renames it or changes its price, Pay later, or deletes it.
export default function OrgPrices({
  programId,
  standardCents,
  groups,
  choices,
}: {
  programId: string;
  standardCents: number | null; // the League's ALL Season price
  groups: PriceGroup[];
  choices: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // an organization tapped (then tap a group)
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const name = new Map(choices.map((c) => [c.slug, c.name]));
  const groupOf = new Map(groups.flatMap((g) => g.orgs.map((o) => [o, g.id] as const)));
  const members = (key: string) =>
    (key === NONE ? choices.filter((c) => !groupOf.has(c.slug)).map((c) => c.slug) : (groups.find((g) => g.id === key)?.orgs ?? [])).sort(
      (a, b) => (name.get(a) ?? a).localeCompare(name.get(b) ?? b),
    );

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg(r.message ?? "Something went wrong.");
      done?.();
      router.refresh();
    });
  const move = (org: string, key: string) => {
    setPicked(null);
    if (key === (groupOf.get(org) ?? NONE)) return;
    act(() => tagOrgs(programId, [org], key === NONE ? null : key));
  };

  const touch = useTouchDrag({
    onStart: (org) => {
      setPicked(null);
      setDragging(org);
    },
    onOver: (key) => setOver(key),
    onDrop: (org, key) => {
      setDragging(null);
      setOver(null);
      if (key) move(org, key);
    },
    onCancel: () => {
      setDragging(null);
      setOver(null);
    },
  });
  const target = (key: string) => ({
    "data-drop": key,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const org = e.dataTransfer.getData("text/plain");
      if (org) move(org, key);
    },
    onClick: () => {
      if (touch.justDropped() || !picked) return;
      move(picked, key);
    },
  });
  const chip = (org: string) => {
    const on = picked === org;
    return (
      <button
        key={org}
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", org);
          setPicked(null);
          setDragging(org);
        }}
        onDragEnd={() => setDragging(null)}
        {...touch.source(org, name.get(org) ?? org)}
        onClick={(e) => {
          e.stopPropagation();
          if (touch.justDropped()) return;
          setPicked(on ? null : org);
        }}
        className={`cursor-grab touch-manipulation rounded-full px-3 py-1 text-xs font-medium shadow-sm ring-1 select-none [-webkit-touch-callout:none] active:cursor-grabbing ${
          on ? "bg-scenic-navy text-white ring-scenic-navy" : "bg-white ring-zinc-950/10 dark:bg-zinc-800 dark:ring-white/15"
        } ${dragging === org ? "opacity-40" : ""}`}
      >
        {name.get(org) ?? org}
      </button>
    );
  };
  const box = (key: string, head: React.ReactNode, tone: string) => {
    const list = members(key);
    return (
      <div
        key={key}
        {...target(key)}
        className={`space-y-2 rounded-xl p-3 transition ${tone} ${
          over === key
            ? "ring-2 ring-scenic-navy dark:ring-white"
            : picked || dragging
              ? "ring-1 ring-scenic-navy/40 dark:ring-white/40"
              : "ring-1 ring-zinc-950/10 dark:ring-white/15"
        }`}
      >
        {head}
        <div className="flex flex-wrap gap-1.5">
          {list.length ? list.map(chip) : <span className="text-xs text-zinc-500">Drag organizations here</span>}
        </div>
      </div>
    );
  };

  return (
    <SubCard
      title="Organization prices"
      count={groups.length || undefined}
      action={
        <button
          type="button"
          aria-label={adding ? "Close" : "Add a price group"}
          onClick={() => setAdding((a) => !a)}
          className="flex size-8 items-center justify-center rounded-full bg-thunder-blue text-xl leading-none font-light text-white"
        >
          {adding ? "−" : "+"}
        </button>
      }
    >
      {touch.ghost}
      <p className="mb-2 text-xs text-zinc-500">
        Name a price group, then drag organizations into it: they&apos;re tagged with its name and get its ALL Season price (and Pay
        later: their teams register without paying by card; Scenic City&apos;s Owners mark them Paid). Untagged organizations pay the
        standard price. On a phone: press and hold, then slide; or tap one, then tap the group.
      </p>
      {adding && (
        <GroupForm
          submit="Add group"
          busy={busy}
          onSave={(g) => act(() => savePriceGroup(programId, null, g), () => setAdding(false))}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="space-y-2">
        {box(
          NONE,
          <p className="text-sm font-semibold">
            Standard{standardCents !== null ? ` · $${dollars(standardCents)}` : ""} · pay by card
            <span className="font-normal text-zinc-500"> (no tag)</span>
          </p>,
          "bg-zinc-50 dark:bg-white/5",
        )}
        {groups.map((g) =>
          box(
            g.id,
            <GroupHead
              group={g}
              busy={busy}
              onSave={(input) => act(() => savePriceGroup(programId, g.id, input))}
              onDelete={() => act(() => deletePriceGroup(programId, g.id))}
            />,
            "bg-indigo-50/60 dark:bg-indigo-500/10",
          ),
        )}
      </div>
      {msg && <Toast key={msg} message={msg} />}
    </SubCard>
  );
}

type GroupInput = { name: string; allSeason: string; payLater: boolean };

// A group's tag and terms ("Partner Clubs · $200 · Pay later") with Edit: rename, price, Pay later, or Delete.
function GroupHead({
  group,
  busy,
  onSave,
  onDelete,
}: {
  group: PriceGroup;
  busy: boolean;
  onSave: (g: GroupInput) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <GroupForm
        group={group}
        submit="Save"
        busy={busy}
        onSave={(g) => {
          onSave(g);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        onDelete={onDelete}
      />
    );
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 text-sm">
        <span className="inline-block rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">{group.name}</span>
        <span className="ml-2 text-zinc-600 dark:text-zinc-300">
          {group.allSeasonCents === null ? "standard price" : `$${dollars(group.allSeasonCents)} ALL Season`} ·{" "}
          {group.payLater ? "Pay later" : "pay by card"}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="shrink-0 text-xs font-medium text-thunder-blue dark:text-blue-400"
      >
        Edit
      </button>
    </div>
  );
}

// A group's name (its tag), ALL Season price (blank: the League's) and Pay later; Delete when editing one.
function GroupForm({
  group,
  submit,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  group?: PriceGroup;
  submit: string;
  busy?: boolean;
  onSave: (g: GroupInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(group?.name ?? "");
  const [price, setPrice] = useState(dollars(group?.allSeasonCents ?? null));
  const [later, setLater] = useState(group?.payLater ?? false);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mb-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15" onClick={(e) => e.stopPropagation()}>
      <input
        placeholder="Group name (the tag), e.g. Partner Clubs"
        maxLength={40}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          ALL Season $
          <input
            inputMode="decimal"
            placeholder="standard"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 tabular-nums dark:border-white/15 dark:bg-zinc-900"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="size-4 accent-thunder-blue" checked={later} onChange={(e) => setLater(e.target.checked)} />
          Pay later
        </label>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!label.trim()) return setErr("Name the group.");
            const t = price.trim().replace(/^\$/, "");
            if (t && !/^\d{1,6}(\.\d{1,2})?$/.test(t)) return setErr("Enter a price in dollars, like 200 or 200.00.");
            onSave({ name: label.trim(), allSeason: t, payLater: later });
          }}
          className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submit}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => (sure ? onDelete() : setSure(true))}
            className="rounded-full px-3.5 py-1.5 text-sm font-medium text-red-600 ring-1 ring-red-600/30"
          >
            {sure ? "Yes, delete (its organizations go back to standard)" : "Delete group"}
          </button>
        )}
      </div>
    </div>
  );
}
