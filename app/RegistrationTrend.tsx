"use client";

import BarChart from "./BarChart";

// Home metrics: registrations each day for the last 30 days, one bar per day (Eastern dates).
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

export default function RegistrationTrend({ daily }: { daily: { day: string; n: number }[] }) {
  const total = daily.reduce((a, d) => a + d.n, 0);
  return (
    <BarChart
      bars={daily.map((d) => ({
        key: d.day,
        n: d.n,
        label: `${fmt(d.day, { weekday: "short", month: "short", day: "numeric" })}: ${d.n} registration${d.n === 1 ? "" : "s"}`,
      }))}
      summary={`${total} in ${daily.length} days`}
      first={fmt(daily[0].day, { month: "short", day: "numeric" })}
      last="Today"
      ariaLabel="Registrations per day"
    />
  );
}
