import { describe, expect, it } from "vitest";
import { feeTrend } from "./fee-trend";

describe("fee trend (paid and owed to date)", () => {
  it("paid up front counts on the day registered; a plan splits the paid amount over its PAID installments", () => {
    const rows = [
      // Paid $135 up front on Oct 2.
      { registeredOn: "2026-10-02", paid: 135, remaining: 0, installments: ["N/A", "N/A", "N/A"] },
      // A $150 plan: two of three paid ($100), $50 left.
      {
        registeredOn: "2026-10-03",
        paid: 100,
        remaining: 50,
        installments: ["2026-10-03 - PAID", "2026-11-03 - PAID", "2026-12-03 - SCHEDULED"],
      },
      // Registered, nothing paid yet ($145 owed).
      { registeredOn: "2026-10-04", paid: 0, remaining: 145, installments: [null, null, null] },
    ];
    const t = feeTrend(rows, "2026-11-05");
    expect(t[0]).toEqual({ day: "2026-10-02", paid: 135, owed: 0 });
    expect(t[1]).toEqual({ day: "2026-10-03", paid: 185, owed: 100 }); // $50 of the plan's $150 paid
    expect(t[2]).toEqual({ day: "2026-10-04", paid: 185, owed: 245 });
    expect(t.find((d) => d.day === "2026-11-03")).toEqual({ day: "2026-11-03", paid: 235, owed: 195 });
    // Ends today at the totals: everything paid, and today's amount remaining.
    expect(t.at(-1)).toEqual({ day: "2026-11-05", paid: 235, owed: 195 });
    expect(t).toHaveLength(35);
  });

  it("an installment paid early (marked PAID, dated after today) counts today, so the totals match", () => {
    const t = feeTrend(
      [{ registeredOn: "2026-11-01", paid: 90, remaining: 45, installments: ["2026-11-01 - PAID", "2026-12-01 - PAID", "2027-01-01 - SCHEDULED"] }],
      "2026-11-11",
    );
    expect(t.at(-1)).toEqual({ day: "2026-11-11", paid: 90, owed: 45 });
    expect(t.at(-2)).toEqual({ day: "2026-11-10", paid: 45, owed: 90 });
  });

  it("rounding keeps the total exact, and nothing paid yet means no trend", () => {
    const t = feeTrend(
      [{ registeredOn: "2026-10-01", paid: 100, remaining: 0, installments: ["2026-10-01 - PAID", "2026-10-02 - PAID", "2026-10-03 - PAID"] }],
      "2026-10-03",
    );
    expect(t.map((d) => d.paid)).toEqual([33.33, 66.66, 100]);
    expect(feeTrend([{ registeredOn: "2026-10-01", paid: 0, remaining: 50, installments: [] }], "2026-10-03")).toEqual([]);
  });
});
