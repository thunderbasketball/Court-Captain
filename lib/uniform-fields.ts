// Uniform choices and checks shared by the server rules and the Uniforms screen (no database code here).
export const SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AXS", "AS", "AM", "AL", "AXL"] as const;

export type UniformRow = {
  registrantId: string;
  firstName: string;
  lastName: string;
  grade: string;
  ordered: boolean; // needs a uniform: ordered at registration, or a coach said so
  registered: boolean; // the family ordered one at registration (TeamSnap)
  neededBy: string | null; // the coach who said they need one (when they didn't order at registration)
  addedBy: string | null; // the Director who added it to the TeamSnap order
  late: boolean; // ✱ added after registration: their coach ticked Needs a uniform, or the Uniform Fee was added to a NO
  askedSize: string | null; // what the parent asked for at registration
  askedNumber: string | null;
  number: string | null;
  size: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

// A player is missing something until they have a number, and a size if they ordered a uniform.
export const isMissing = (r: Pick<UniformRow, "ordered" | "number" | "size">) => !r.number || (r.ordered && !r.size);

// Numbers used by more than one player on the team.
export const duplicateNumbers = (rows: Pick<UniformRow, "number">[]) => {
  const seen = new Map<string, number>();
  for (const r of rows) if (r.number) seen.set(r.number, (seen.get(r.number) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([num]) => num));
};

// The last name as printed on a jersey: ALL CAPS, without a suffix (Jr, III…) or a "#11" someone typed in.
// Keeps the small prefix of names like McCrobey, MacDonald, DeShields, LaFleur: McCROBEY, MacDONALD, DeSHIELDS.
// "Mc" always stays (even if typed "MCCROBEY"); other prefixes only when the name was typed with the inner capital.
export function jerseyName(lastName: string): string {
  let name = lastName.trim().replace(/\s*#\s*\d+$/, "");
  for (let prev = ""; prev !== name;) {
    prev = name;
    name = name.replace(/[\s,]+(jr|sr|ii|iii|iv|v|2nd|3rd)\.?$/i, "").trim();
  }
  return name
    .split(/([\s'-]+)/)
    .map((part) => {
      const mc = /^mc(?=\p{L})/iu.exec(part);
      const prefix = mc ? "Mc" : /^\p{Lu}\p{Ll}{1,2}(?=\p{Lu})/u.exec(part)?.[0];
      return prefix ? prefix + part.slice(prefix.length).toUpperCase() : part.toUpperCase();
    })
    .join("");
}
