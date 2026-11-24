// Reading a typed birthdate or grade (no database: used in the forms and on the server).

// "2014-05-03", "5/3/2014" or "05-03-2014" → "2014-05-03" (a real date, a year from 1990 on); "" → null; else undefined.
export function birthdateOf(v: unknown): string | null | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
  else return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 1990 || y > 2035) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "3", "3rd", "K", "Kindergarten" → 0 … 12.
export function gradeOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 12 ? v : null;
  if (typeof v !== "string") return null;
  const s = v
    .toLowerCase()
    .replace(/grade/g, "")
    .trim()
    .replace(/(st|nd|rd|th)$/, "")
    .trim();
  if (s === "k" || s === "kindergarten") return 0;
  return /^\d{1,2}$/.test(s) && Number(s) <= 12 ? Number(s) : null;
}
