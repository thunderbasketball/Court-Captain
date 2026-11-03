// Families built from registrations (SPEC.md section 15). One family is every registration linked together: siblings on
// the same registration, and registrations that share a parent's cell or email. Each family gathers its parents
// (guardians), address, children and fees, and which parents have a login (matched by cell).

export type RegRow = {
  registrantId: string;
  registrationId: string;
  first: string;
  last: string;
  gender: string;
  grade: string;
  gradeSort: number;
  birthdate: string | null; // YYYY-MM-DD
  team: string | null;
  uniformSize: string | null;
  uniformNumber: string | null;
  parents: { first: string | null; last: string | null; cell: string | null; email: string | null }[]; // parent 1, then 2
  address: string | null; // one line: street, city, state zip
  registeredAt: string | null;
  totalFees: number | null;
  amountPaid: number | null;
  amountRemaining: number | null;
  addedBy: string | null; // added in the app (not from TeamSnap)
  feesWaivedBy: string | null;
};

export type Guardian = { name: string; cell: string | null; email: string | null; login: string | null };
export type Child = {
  name: string;
  gender: string;
  grade: string;
  birthdate: string | null;
  team: string | null;
  uniformSize: string | null;
  uniformNumber: string | null;
  addedInApp: boolean;
  feesWaivedBy: string | null;
};
export type Family = {
  key: string;
  name: string; // e.g. "Clemons family"
  guardians: Guardian[];
  address: string | null;
  children: Child[]; // youngest grade first
  fees: { total: number; paid: number; remaining: number } | null;
  connected: boolean; // a guardian has a login
};

const cellKey = (c: string | null) => (c && /^\d{10}$/.test(c) ? `cell:${c}` : null);
const emailKey = (e: string | null) => (e && e.includes("@") ? `email:${e.trim().toLowerCase()}` : null);

// Pure: group registration rows into families. `logins` maps a cell to the name on its login.
export function buildFamilies(rows: RegRow[], logins: Map<string, string>): Family[] {
  // Union-find over registrations and the parent cells/emails they mention.
  const up = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (up.has(r) && up.get(r) !== r) r = up.get(r)!;
    up.set(k, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) up.set(rb, ra);
  };
  for (const r of rows) {
    const reg = `reg:${r.registrationId}`;
    find(reg);
    for (const p of r.parents) for (const k of [cellKey(p.cell), emailKey(p.email)]) if (k) join(reg, k);
  }
  const groups = new Map<string, RegRow[]>();
  for (const r of rows) {
    const root = find(`reg:${r.registrationId}`);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }

  const families: Family[] = [];
  for (const [key, regs] of groups) {
    // Newest registration first, so its address and spelling win.
    regs.sort((a, b) => (b.registeredAt ?? "").localeCompare(a.registeredAt ?? ""));
    const guardians: Guardian[] = [];
    for (const r of regs)
      for (const p of r.parents) {
        const name = [p.first?.trim(), p.last?.trim()].filter(Boolean).join(" ");
        if (!name && !p.cell && !p.email) continue;
        const same = guardians.find(
          (g) =>
            (p.cell && g.cell === p.cell) ||
            (p.email && g.email?.toLowerCase() === p.email.toLowerCase()) ||
            (name && g.name.toLowerCase() === name.toLowerCase()),
        );
        if (same) {
          same.cell ??= p.cell;
          same.email ??= p.email;
          same.login ??= (p.cell && logins.get(p.cell)) || null;
          continue;
        }
        guardians.push({
          name: name || "Name not given",
          cell: p.cell,
          email: p.email,
          login: (p.cell && logins.get(p.cell)) || null,
        });
      }
    const seen = new Set<string>();
    const children: Child[] = [];
    for (const r of [...regs].sort((a, b) => a.gradeSort - b.gradeSort || a.first.localeCompare(b.first))) {
      const id = `${r.first} ${r.last}`.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      children.push({
        name: `${r.first} ${r.last}`,
        gender: r.gender,
        grade: r.grade,
        birthdate: r.birthdate,
        team: r.team,
        uniformSize: r.uniformSize,
        uniformNumber: r.uniformNumber,
        addedInApp: r.addedBy !== null,
        feesWaivedBy: r.feesWaivedBy,
      });
    }
    const money = regs.filter((r) => r.totalFees !== null);
    const sum = (f: (r: RegRow) => number | null) => money.reduce((n, r) => n + (f(r) ?? 0), 0);
    const surname = regs[0].parents[0]?.last?.trim() || regs[0].last;
    families.push({
      key,
      name: `${surname} family`,
      guardians,
      address: regs.find((r) => r.address)?.address ?? null,
      children,
      fees: money.length
        ? { total: sum((r) => r.totalFees), paid: sum((r) => r.amountPaid), remaining: sum((r) => r.amountRemaining) }
        : null,
      connected: guardians.some((g) => g.login),
    });
  }
  return families.sort((a, b) => a.name.localeCompare(b.name));
}
