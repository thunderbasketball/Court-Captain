// Uniform vendor (Thunder's Uniforms card, Directors of Uniforms; SPEC.md section 15): the vendor's email and who's
// copied (the card's gear), and Email the vendor: the uniform order, GIRLS then BOYS, each team's players by jersey
// number (team, LAST NAME, number, size), in the email and as an attached spreadsheet. Each send records its players, so
// the next one has only the new ones (Send everyone: the full list again). A player without a number or size is held back
// until both are set. Each order's number is the date it's sent (20261120; a second that day 20261120-2). Who set or sent
// it is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail } from "./auth/validate";
import type { Mail } from "./email";
import { hasArea } from "./org-admin";
import { withTx } from "./sql";
import { jerseyName } from "./uniform-fields";
import { TZ } from "./time";

type Deps = { pool: Pool; now: () => Date; sendMail: (m: Mail) => Promise<void> };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const ORG = "thunder"; // uniforms are kept for Thunder's teams
export const MAX_CC = 10;

export type VendorRow = {
  teamId: string;
  team: string;
  gender: string; // "Girls" | "Boys"
  registrantId: string;
  name: string; // jersey name: "McMAHAN"
  number: string | null;
  size: string | null;
};
export type VendorView = {
  email: string | null;
  cc: string[];
  setBy: string | null;
  setAt: Date | null;
  ready: VendorRow[]; // complete and not sent yet
  held: (VendorRow & { missing: string })[]; // not sent yet, missing a number or size
  sentPlayers: number; // already sent (still ordering)
  last: { orderNo: string; sentAt: Date; sentBy: string; players: number; everyone: boolean; to: string } | null;
};

const may = (viewer: SessionUser) => hasArea(viewer, "uniforms");

// Every rostered player who ordered a uniform, GIRLS then BOYS, youngest team first, then by jersey number.
async function orderRows(q: Pick<Pool, "query">): Promise<(VendorRow & { sent: boolean })[]> {
  const r = await q.query<Omit<VendorRow, "name"> & { lastName: string; sent: boolean }>(
    `select t.id::text as "teamId", t.name as team, t.gender, p.registrant_id as "registrantId", p.last_name as "lastName",
            u.number, u.size, (s.x is not null) as sent
       from team_players p
       join teams t on t.id = p.team_id
       left join registrations g on g.registrant_id = p.registrant_id
       left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
       left join lateral (select 1 as x from uniform_vendor_sent s join uniform_vendor_sends o on o.id = s.send_id
                          where s.team_id = p.team_id and s.registrant_id = p.registrant_id and o.cancelled_at is null
                            and s.number = u.number and s.size = u.size
                            and (u.reorder_at is null or o.sent_at > u.reorder_at) limit 1) s on true
      where coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null
      order by (t.gender = 'Girls') desc, t.grade_sort, lower(t.name),
               case when u.number ~ '^[0-9]+$' then u.number::int end nulls last, u.number, lower(p.last_name)`,
  );
  return r.rows.map(({ lastName, ...x }) => ({ ...x, name: jerseyName(lastName) }));
}

const missingOf = (r: VendorRow) =>
  !r.number && !r.size ? "no number or size" : !r.number ? "no number" : !r.size ? "no size" : null;

export async function vendorView(deps: Pick<Deps, "pool">, viewer: SessionUser): Promise<VendorView | null> {
  if (!may(viewer)) return null;
  const [s, rows, last] = await Promise.all([
    deps.pool.query<{ email: string | null; cc: string[]; set_by: string; set_at: Date }>(
      "select email, cc, set_by, set_at from uniform_vendor where org = $1",
      [ORG],
    ),
    orderRows(deps.pool),
    deps.pool.query<{ order_no: string; sent_at: Date; sent_by: string; players: number; everyone: boolean; sent_to: string }>(
      "select order_no, sent_at, sent_by, players, everyone, sent_to from uniform_vendor_sends where org = $1 and cancelled_at is null order by sent_at desc, id desc limit 1",
      [ORG],
    ),
  ]);
  const v = s.rows[0];
  const l = last.rows[0];
  const unsent = rows.filter((r) => !r.sent);
  return {
    email: v?.email ?? null,
    cc: v?.cc ?? [],
    setBy: v?.set_by ?? null,
    setAt: v?.set_at ?? null,
    ready: unsent.filter((r) => !missingOf(r)).map(strip),
    held: unsent.flatMap((r) => {
      const m = missingOf(r);
      return m ? [{ ...strip(r), missing: m }] : [];
    }),
    sentPlayers: rows.length - unsent.length,
    last: l ? { orderNo: l.order_no, sentAt: l.sent_at, sentBy: l.sent_by, players: l.players, everyone: l.everyone, to: l.sent_to } : null,
  };
}
const strip = (r: VendorRow & { sent: boolean }): VendorRow => {
  const { sent, ...rest } = r;
  void sent;
  return rest;
};

export type PastOrder = {
  orderNo: string;
  sentAt: Date;
  sentBy: string;
  to: string;
  cc: string[];
  everyone: boolean;
  cancelled: { by: string; at: Date } | null;
  canCancel: boolean; // the newest order not cancelled
  players: VendorRow[]; // as sent: GIRLS then BOYS, by team, then jersey number
};

// Past orders, newest first, each with its players as they were sent (Directors of Uniforms).
export async function pastOrders(deps: Pick<Deps, "pool">, viewer: SessionUser): Promise<PastOrder[] | null> {
  if (!may(viewer)) return null;
  const [sends, players] = await Promise.all([
    deps.pool.query<{
      id: string;
      order_no: string;
      sent_at: Date;
      sent_by: string;
      sent_to: string;
      cc: string[];
      everyone: boolean;
      cancelled_by: string | null;
      cancelled_at: Date | null;
    }>(
      `select id::text, order_no, sent_at, sent_by, sent_to, cc, everyone, cancelled_by, cancelled_at
         from uniform_vendor_sends where org = $1 order by sent_at desc, id desc`,
      [ORG],
    ),
    deps.pool.query<VendorRow & { sendId: string }>(
      `select s.send_id::text as "sendId", s.team_id::text as "teamId", s.team, s.gender, s.registrant_id as "registrantId",
              s.name, s.number, s.size
         from uniform_vendor_sent s join uniform_vendor_sends o on o.id = s.send_id
         left join teams t on t.id = s.team_id
        where o.org = $1
        order by (s.gender = 'Girls') desc, t.grade_sort nulls last, lower(s.team),
                 case when s.number ~ '^[0-9]+$' then s.number::int end nulls last, s.number, lower(s.name)`,
      [ORG],
    ),
  ]);
  const newest = sends.rows.find((o) => !o.cancelled_at)?.id;
  return sends.rows.map((o) => ({
    orderNo: o.order_no,
    sentAt: o.sent_at,
    sentBy: o.sent_by,
    to: o.sent_to,
    cc: o.cc,
    everyone: o.everyone,
    cancelled: o.cancelled_at ? { by: o.cancelled_by ?? "", at: o.cancelled_at } : null,
    canCancel: o.id === newest,
    players: players.rows
      .filter((p) => p.sendId === o.id)
      .map((p) => ({ teamId: p.teamId, team: p.team, gender: p.gender, registrantId: p.registrantId, name: p.name, number: p.number, size: p.size })),
  }));
}

// The gear: the vendor's email (required to send) and up to 10 people copied, one per line or separated by commas.
export async function saveVendor(deps: Pick<Deps, "pool" | "now">, viewer: SessionUser, emailIn: unknown, ccIn: unknown): Promise<Result> {
  if (!may(viewer) || viewer.actingBy) return { ok: false, message: "Only a Director of Uniforms can change this." };
  const raw = typeof emailIn === "string" ? emailIn.trim() : "";
  const email = raw ? cleanEmail(raw) : null;
  if (raw && !email) return { ok: false, message: "Enter the vendor's email address." };
  const parts = (typeof ccIn === "string" ? ccIn : "").split(/[\s,;]+/).filter(Boolean);
  const cc: string[] = [];
  for (const p of parts) {
    const e = cleanEmail(p);
    if (!e) return { ok: false, message: `"${p.slice(0, 60)}" isn't an email address.` };
    if (!cc.includes(e) && e !== email) cc.push(e);
  }
  if (cc.length > MAX_CC) return { ok: false, message: `Copy up to ${MAX_CC} people.` };
  await deps.pool.query(
    `insert into uniform_vendor (org, email, cc, set_by, set_at) values ($1, $2, $3, $4, $5)
     on conflict (org) do update set email = $2, cc = $3, set_by = $4, set_at = $5`,
    [ORG, email, cc, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return { ok: true };
}

// The order as it will go out (the preview and the send build it the same way): the vendor, the Cc (with the sender
// always copied, when they have an email on file), the next order number, and the new players (or everyone).
export type OrderDraft = {
  to: string;
  cc: string[];
  senderCopied: boolean; // false: the sender has no email on file
  orderNo: string;
  subject: string;
  text: string;
  filename: string;
  rows: VendorRow[];
};

async function draftOrder(
  q: Pick<Pool, "query">,
  viewer: SessionUser,
  everyone: boolean,
  now: Date,
): Promise<{ ok: true; draft: OrderDraft } | { ok: false; message: string }> {
  const [v, me, all] = await Promise.all([
    q.query<{ email: string | null; cc: string[] }>("select email, cc from uniform_vendor where org = $1", [ORG]),
    q.query<{ email: string | null }>("select email from users where coach_id = $1", [viewer.coachId]),
    orderRows(q),
  ]);
  const to = v.rows[0]?.email;
  if (!to) return { ok: false, message: "Set the vendor's email first (the gear on this card)." };
  const sender = cleanEmail(me.rows[0]?.email);
  const cc = [...v.rows[0].cc];
  if (sender && sender !== to && !cc.includes(sender)) cc.push(sender);
  const rows = all.filter((r) => !missingOf(r) && (everyone || !r.sent)).map(strip);
  if (!rows.length) return { ok: false, message: everyone ? "No uniforms to send yet." : "No new uniforms to send." };
  const day = now.toLocaleDateString("en-CA", { timeZone: TZ }).replace(/-/g, ""); // 20261120 (Eastern)
  const sameDay = await q.query<{ n: number }>("select count(*)::int as n from uniform_vendor_sends where org = $1 and order_no like $2", [
    ORG,
    `${day}%`,
  ]);
  const orderNo = sameDay.rows[0].n ? `${day}-${sameDay.rows[0].n + 1}` : day;
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  return {
    ok: true,
    draft: {
      to,
      cc,
      senderCopied: !!sender,
      orderNo,
      subject: `Thunder Basketball uniform order #${orderNo}: ${rows.length} player${rows.length === 1 ? "" : "s"}`,
      text: orderText(rows, everyone, by, date, orderNo),
      filename: `Thunder uniform order ${orderNo}.csv`,
      rows,
    },
  };
}

// Preview: the email exactly as Send would send it now (nothing is recorded or sent).
export async function previewVendorOrder(
  deps: Pick<Deps, "pool" | "now">,
  viewer: SessionUser,
  everyone: boolean,
): Promise<Result<{ draft: Omit<OrderDraft, "rows"> & { players: number } }>> {
  if (!may(viewer) || viewer.actingBy) return { ok: false, message: "Only a Director of Uniforms can send the uniform order." };
  const d = await draftOrder(deps.pool, viewer, everyone, deps.now());
  if (!d.ok) return d;
  const { rows, ...rest } = d.draft;
  return { ok: true, draft: { ...rest, players: rows.length } };
}

// Email the vendor: the new players (or, `everyone`, every complete one), in one transaction with the record of who was
// sent; if the email fails nothing is recorded.
export async function sendToVendor(
  deps: Deps,
  viewer: SessionUser,
  everyone: boolean,
): Promise<Result<{ players: number; orderNo: string }>> {
  if (!may(viewer) || viewer.actingBy) return { ok: false, message: "Only a Director of Uniforms can send the uniform order." };
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('uniform-vendor:' || $1))", [ORG]);
    const now = deps.now();
    const d = await draftOrder(q, viewer, everyone, now);
    if (!d.ok) return d;
    const { to, cc, orderNo, rows } = d.draft;
    const send = await q.query<{ id: string }>(
      `insert into uniform_vendor_sends (org, order_no, sent_to, cc, players, everyone, sent_by, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
      [ORG, orderNo, to, cc, rows.length, everyone, `${viewer.firstName} ${viewer.lastName}`, now],
    );
    await q.query(
      `insert into uniform_vendor_sent (send_id, team_id, registrant_id, team, gender, name, number, size)
       select $2, (x->>'teamId')::bigint, x->>'registrantId', x->>'team', x->>'gender', x->>'name', x->>'number', x->>'size'
         from jsonb_array_elements($1::jsonb) x`,
      [JSON.stringify(rows), send.rows[0].id],
    );
    await deps.sendMail({
      to,
      cc,
      subject: d.draft.subject,
      text: d.draft.text,
      attachments: [{ filename: d.draft.filename, content: orderCsv(rows, orderNo), contentType: "text/csv" }],
    });
    return { ok: true as const, players: rows.length, orderNo };
  });
}

// Cancel order (the newest one not cancelled; it had errors): kept and marked cancelled with who and when, its players
// count as not sent again (fix them, then Email the vendor sends a corrected order with a new number). `notify`: also
// email the vendor (and the order's Cc, with the person cancelling copied) that it's cancelled. If that email fails,
// nothing changes.
export async function cancelOrder(deps: Deps, viewer: SessionUser, orderNo: unknown, notify: boolean): Promise<Result> {
  if (!may(viewer) || viewer.actingBy) return { ok: false, message: "Only a Director of Uniforms can cancel an order." };
  if (typeof orderNo !== "string" || !/^[0-9]{8}(-[0-9]{1,3})?$/.test(orderNo)) return { ok: false, message: "Pick an order." };
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('uniform-vendor:' || $1))", [ORG]);
    const o = await q.query<{ id: string; order_no: string; sent_to: string; cc: string[]; players: number }>(
      `select id::text, order_no, sent_to, cc, players from uniform_vendor_sends
        where org = $1 and cancelled_at is null order by sent_at desc, id desc limit 1`,
      [ORG],
    );
    const last = o.rows[0];
    if (!last || last.order_no !== orderNo) return { ok: false as const, message: "Only the newest order can be cancelled." };
    const by = `${viewer.firstName} ${viewer.lastName}`;
    await q.query("update uniform_vendor_sends set cancelled_by = $2, cancelled_at = $3 where id = $1", [last.id, by, deps.now()]);
    if (notify) {
      const me = cleanEmail((await q.query<{ email: string | null }>("select email from users where coach_id = $1", [viewer.coachId])).rows[0]?.email);
      const cc = [...last.cc];
      if (me && me !== last.sent_to && !cc.includes(me)) cc.push(me);
      await deps.sendMail({
        to: last.sent_to,
        cc,
        subject: `CANCELLED: Thunder Basketball uniform order #${last.order_no}`,
        text: [
          "Hi,",
          "",
          `Please cancel Thunder Basketball's uniform order #${last.order_no} (${last.players} player${last.players === 1 ? "" : "s"}). It had errors; we'll send a corrected order with a new order number.`,
          "",
          `Cancelled by ${by}.`,
        ].join("\n"),
      });
    }
    return { ok: true as const };
  });
}

const sections = (rows: VendorRow[]) =>
  ["Girls", "Boys"].map((g) => ({ label: g.toUpperCase(), rows: rows.filter((r) => r.gender === g) })).filter((s) => s.rows.length);

export function orderText(rows: VendorRow[], everyone: boolean, by: string, date: string, orderNo: string): string {
  const lines = [
    "Hi,",
    "",
    `Here is Thunder Basketball's uniform order #${orderNo}: ${rows.length} ${everyone ? "" : "new "}player${rows.length === 1 ? "" : "s"} (team, last name, number, size). The same list is attached as a spreadsheet.`,
  ];
  for (const s of sections(rows)) {
    lines.push("", s.label);
    let team = "";
    for (const r of s.rows) {
      if (team && r.team !== team) lines.push("");
      team = r.team;
      lines.push(`${r.team}  ${r.name}  #${r.number}  ${r.size}`);
    }
  }
  lines.push("", `Sent by ${by} on ${date}.`);
  return lines.join("\n");
}

// A spreadsheet cell: never a formula (= + - @ get a leading '), quoted when it holds a comma, quote or line break.
const cell = (v: string | null) => {
  const s = /^[=+\-@\t\r]/.test(v ?? "") ? `'${v}` : (v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Like the order sheet: GIRLS, its teams' rows (a blank row between teams), then BOYS.
export function orderCsv(rows: VendorRow[], orderNo: string): string {
  const out = [[`Thunder Basketball uniform order #${orderNo}`], [], ["Team", "Last name", "Number", "Size"]];
  for (const s of sections(rows)) {
    out.push([], [s.label]);
    let team = "";
    for (const r of s.rows) {
      if (team && r.team !== team) out.push([]);
      team = r.team;
      out.push([r.team, r.name, r.number ?? "", r.size ?? ""]);
    }
  }
  return out.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
