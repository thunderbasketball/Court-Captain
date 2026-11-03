// Site visits' time ranges (lib/site-visits.ts), shared with the Home page's chart.
export const VISIT_RANGES = [
  { key: "today", label: "Today", period: "day", step: "hour" },
  { key: "week", label: "This Week", period: "week", step: "day" },
  { key: "month", label: "This Month", period: "month", step: "day" },
  { key: "year", label: "This Year", period: "year", step: "month" },
] as const;
export type VisitRange = (typeof VISIT_RANGES)[number]["key"];
