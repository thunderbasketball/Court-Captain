"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, useConfirm } from "../../client-ui";
import { card, fieldLabel as label, inputCls, pillCls as pill, primaryBtn } from "../../ui";
import { previewAudience, sendAnnouncement } from "../actions";

type Choices = { org: string; roles: { key: string; label: string }[]; teams: { id: string; name: string }[]; users: { id: string; name: string }[] };

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function ComposeForm({ choices }: { choices: Choices }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  // Who it will reach, worked out on the server as the picks change.
  const audienceKey = JSON.stringify({ org: choices.org, everyone, roles, teams, users });
  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const r = await previewAudience(JSON.parse(audienceKey));
      if (!stale) setNames(r.ok ? r.names : []);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [audienceKey]);

  const q = search.trim().toLowerCase();
  const matches = q ? choices.users.filter((u) => u.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const picked = choices.users.filter((u) => users.includes(u.id));

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!names.length) return setError("Pick who should get it.");
        const ok = await confirm({
          title: `Send to ${names.length} ${names.length === 1 ? "person" : "people"}?`,
          message: <p>&ldquo;{title.trim() || "(no title)"}&rdquo; goes to their inbox now. It can&apos;t be unsent.</p>,
          confirmLabel: "Send",
          tone: "warning",
        });
        if (!ok) return;
        start(async () => {
          const r = await sendAnnouncement({ org: choices.org, title, body, everyone, roles, teams, users });
          if (!r.ok) return setError(r.message);
          router.push(`/inbox?view=sent&org=${choices.org}`);
        });
      }}
    >
      {confirmDialog}
      <label className="block">
        <span className={label}>Title</span>
        <input
          className={inputCls}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Saturday practice moved"
        />
      </label>
      <label className="block">
        <span className={label}>Message</span>
        <textarea className={`${inputCls} min-h-36`} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </label>

      <section className={`${card} space-y-4 p-4`}>
        <h2 className="font-semibold">Send to</h2>
        <button type="button" className={pill(everyone)} onClick={() => setEveryone(!everyone)}>
          Everyone
        </button>
        {!everyone && (
          <>
            <div>
              <p className={label}>Roles</p>
              <div className="flex flex-wrap gap-2">
                {choices.roles.map((r) => (
                  <button key={r.key} type="button" className={pill(roles.includes(r.key))} onClick={() => setRoles(toggle(roles, r.key))}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={label}>Teams (all staff)</p>
              <div className="flex flex-wrap gap-2">
                {choices.teams.map((t) => (
                  <button key={t.id} type="button" className={pill(teams.includes(t.id))} onClick={() => setTeams(toggle(teams, t.id))}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={label}>People</p>
              {picked.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {picked.map((u) => (
                    <button key={u.id} type="button" className={pill(true)} onClick={() => setUsers(toggle(users, u.id))}>
                      {u.name} ✕
                    </button>
                  ))}
                </div>
              )}
              <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name…" />
              {matches.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/15">
                  {matches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/5"
                        onClick={() => {
                          setUsers(toggle(users, u.id));
                          setSearch("");
                        }}
                      >
                        {u.name}
                        {users.includes(u.id) && <span className="text-thunder-blue">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Goes to {names.length} {names.length === 1 ? "person" : "people"}
          </summary>
          {names.length > 0 && <p className="mt-1 text-zinc-600 dark:text-zinc-300">{names.join(", ")}</p>}
        </details>
      </section>

      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !title.trim() || !body.trim() || !names.length} className={primaryBtn}>
        {busy ? "Sending…" : "Send announcement"}
      </button>
    </form>
  );
}
