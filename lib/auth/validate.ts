// Input checks shared by the server (authoritative) and the login screens (for early messages).

export function isPin(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}$/.test(v);
}

export function isCode(v: unknown): v is string {
  return typeof v === "string" && /^\d{6}$/.test(v);
}

// Letters (any language), spaces, apostrophes, hyphens, periods. Must start with a letter,
// which also blocks spreadsheet formulas (= + - @).
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return /^\p{L}[\p{L} '.-]{0,39}$/u.test(s) ? s : null;
}

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s.length > 254) return null;
  return /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : null;
}

// "earl.epps@gmail.com" -> "e*******s@gmail.com": the first and last letters, a star for each one between (so people
// can tell which address it is). Short names: "ed@…" -> "e*@…", "e@…" -> "e*@…".
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const hidden = user.length <= 2 ? `${user[0]}*` : `${user[0]}${"*".repeat(user.length - 2)}${user.at(-1)}`;
  return `${hidden}@${domain}`;
}
