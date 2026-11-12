"use client";

// The header's 🔍 button (Owners, Admins and Directors): opens a search of the organization right under the header. As
// they type any part of a name, cell, email or place, coaches, players (also found by their parents' names and cells),
// and teams, programs, sessions, scrimmages and gyms fill in; tapping a person opens their card (cell, email, teams,
// parents) with links to their pages; anything else opens its page.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCell } from "@/lib/phone";
import type { CoachHit, PlayerHit, ThingHit } from "@/lib/org-search";
import { searchOrganization } from "./search-actions";
import { Alert } from "./client-ui";
import HeaderDrop from "./HeaderDrop";
import { Chip, EmailLink, PhoneLink, inputCls } from "./ui";

const linkCls = "font-medium text-thunder-blue hover:underline dark:text-blue-400";

export function OrgSearchButton({ org, orgName }: { org: string; orgName: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ coaches: CoachHit[]; players: PlayerHit[]; things: ThingHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // the card shown: "c:<id>" or "p:<key>"
  const latest = useRef(0);

  // Search a moment after typing stops; only the newest answer is shown.
  useEffect(() => {
    const text = q.trim();
    if (text.replace(/\s/g, "").length < 2) return;
    const n = ++latest.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await searchOrganization(org, text);
      if (n !== latest.current) return;
      setBusy(false);
      if (!r.ok) return setError(r.message);
      setError(null);
      setRes({ coaches: r.coaches, players: r.players, things: r.things });
      setOpen(null);
    }, 250);
    return () => clearTimeout(t);
  }, [q, org]);

  const short = q.trim().replace(/\s/g, "").length < 2;
  const none = !short && res && !busy && !res.coaches.length && !res.players.length && !res.things.length;

  const row = (key: string, name: string, sub: string, body: ReactNode) => (
    <li key={key}>
      <button
        type="button"
        aria-expanded={open === key}
        onClick={() => setOpen(open === key ? null : key)}
        className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-zinc-500">{sub}</span>
        </span>
        <span aria-hidden className={`text-zinc-400 transition-transform ${open === key ? "rotate-90" : ""}`}>
          ▸
        </span>
      </button>
      {open === key && <div className="mb-2 space-y-1 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5">{body}</div>}
    </li>
  );

  return (
    <HeaderDrop
      ariaLabel={`Search ${orgName}`}
      title={`Search ${orgName}`}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
      label={
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5">
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
            clipRule="evenodd"
          />
        </svg>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          <p className="text-sm text-zinc-500">Type any part of a name, cell, email, team, gym or program. Parents find their players.</p>
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, cell, email, team…"
            aria-label="Search"
            autoComplete="off"
            className={`${inputCls} mt-3`}
          />
          <div className="mt-3">
            {error && <Alert tone="red">{error}</Alert>}
            {busy && <p className="py-2 text-sm text-zinc-500">Searching…</p>}
            {none && <p className="py-2 text-sm text-zinc-500">Nothing found.</p>}
            {!short && res && res.coaches.length > 0 && (
              <section>
                <h3 className="mt-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">Coaches & staff</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {res.coaches.map((c) =>
                    row(
                      `c:${c.coachId}`,
                      c.name,
                      [...c.roles, ...c.teams.map((t) => `${t.name} ${t.role}`)].join(" · ") || "Coach",
                      <>
                        {c.roles.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {c.roles.map((r) => (
                              <Chip key={r} tone="blue">
                                {r}
                              </Chip>
                            ))}
                          </div>
                        )}
                        <p>
                          <PhoneLink cell={c.cell} label={formatCell(c.cell)} />
                          {c.email && (
                            <>
                              {" · "}
                              <EmailLink email={c.email} />
                            </>
                          )}
                        </p>
                        {c.teams.map((t) => (
                          <p key={t.href + t.name}>
                            <Link href={t.href} className={linkCls} onClick={close}>
                              {t.name}
                            </Link>{" "}
                            <span className="text-zinc-500">· {t.role}</span>
                          </p>
                        ))}
                        {c.dashboard && (
                          <p>
                            <Link href={c.dashboard} className={linkCls} onClick={close}>
                              Open their dashboard →
                            </Link>
                          </p>
                        )}
                      </>,
                    ),
                  )}
                </ul>
              </section>
            )}
            {!short && res && res.players.length > 0 && (
              <section className="mt-3">
                <h3 className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Players</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {res.players.map((p) =>
                    row(
                      `p:${p.key}`,
                      p.name,
                      `${p.detail} · ${p.team ? p.team.name : "Not on a team"}`,
                      <>
                        <p className="text-zinc-600 dark:text-zinc-300">{p.detail}</p>
                        {p.team ? (
                          <p>
                            <Link href={p.team.href} className={linkCls} onClick={close}>
                              {p.team.name}
                            </Link>
                          </p>
                        ) : (
                          <p className="text-zinc-500">Not on a team</p>
                        )}
                        {p.parents.map((g, i) => (
                          <p key={i}>
                            <span className="text-zinc-600 dark:text-zinc-300">{g.name}</span>
                            {g.cell && (
                              <>
                                {" · "}
                                <PhoneLink cell={g.cell} label={formatCell(g.cell)} />
                              </>
                            )}
                            {g.email && (
                              <>
                                {" · "}
                                <EmailLink email={g.email} />
                              </>
                            )}
                          </p>
                        ))}
                      </>,
                    ),
                  )}
                </ul>
              </section>
            )}
            {!short && res && res.things.length > 0 && (
              <section className="mt-3">
                <h3 className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Teams, programs & more</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {res.things.map((t) => (
                    <li key={t.key}>
                      <Link
                        href={t.href}
                        onClick={close}
                        className="flex w-full items-center justify-between gap-3 px-1 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{t.name}</span>
                          <span className="block truncate text-xs text-zinc-500">{t.detail}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 capitalize dark:bg-white/10 dark:text-zinc-300">
                          {t.kind}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </HeaderDrop>
  );
}
