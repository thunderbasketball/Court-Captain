// Thunder's player fees over time (home dashboard): two running totals, day by day (Eastern), from the first payment to
// today. **Fees paid**: every payment so far. **Fees owed**: the fees of everyone registered by that day, less what
// they'd paid by then (it ends at today's amount remaining).
// Payments come from the TeamSnap registration: paid up front, the whole amount paid counts on the day they
// registered; on a payment plan (1st / 2nd / 3rd Payment "2026-11-04 - PAID"), the amount paid is split evenly over the
// installments marked PAID, each on its date (one paid early, dated later than today, counts today). Plain functions (no database), so tests drive them.

export type FeeRow = {
  registeredOn: string; // YYYY-MM-DD, Eastern
  paid: number; // amount paid so far
  remaining: number; // amount still owed
  installments: (string | null)[]; // the raw 1st / 2nd / 3rd Payment columns
};
export type FeeDay = { day: string; paid: number; owed: number };

const PAID = /^(\d{4}-\d{2}-\d{2}) - PAID$/;
const cents = (n: number) => Math.round(n * 100);
const nextDay = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

export function feeTrend(rows: FeeRow[], today: string): FeeDay[] {
  const paidOn = new Map<string, number>(); // cents paid each day
  const feesOn = new Map<string, number>(); // cents of fees registered each day
  const add = (m: Map<string, number>, d: string, c: number) => m.set(d, (m.get(d) ?? 0) + c);
  for (const r of rows) {
    const paid = cents(Math.max(0, r.paid || 0));
    const remaining = cents(Math.max(0, r.remaining || 0));
    add(feesOn, r.registeredOn, paid + remaining);
    if (!paid) continue;
    const dates = r.installments.flatMap((v) => {
      const m = PAID.exec((v ?? "").trim());
      // Paid ahead of its scheduled date (TeamSnap keeps the scheduled date): counted today at the latest.
      return m ? [m[1] > today ? today : m[1]] : [];
    });
    if (!dates.length) add(paidOn, r.registeredOn, paid);
    else
      dates.forEach((d, i) => {
        // Even split; the last one takes the rounding so the total is exact.
        const share = Math.floor(paid / dates.length);
        add(paidOn, d, i === dates.length - 1 ? paid - share * (dates.length - 1) : share);
      });
  }
  if (!paidOn.size) return [];
  const start = [...paidOn.keys()].sort()[0]; // the first payment
  let paid = 0;
  let fees = 0;
  // Fees registered before the first payment count from the start.
  for (const [d, c] of feesOn) if (d < start) fees += c;
  const out: FeeDay[] = [];
  for (let d = start; d <= today; d = nextDay(d)) {
    paid += paidOn.get(d) ?? 0;
    fees += feesOn.get(d) ?? 0;
    out.push({ day: d, paid: paid / 100, owed: Math.max(0, fees - paid) / 100 });
    if (out.length > 800) break; // a guard: never more than about two years of days
  }
  return out;
}
