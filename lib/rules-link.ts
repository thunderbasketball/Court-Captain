// A League's rules link (SPEC.md section 13): a Google Doc shows inside the page (its preview) and prints as a PDF (its export);
// any other https link just opens.
export const googleDocId = (url: string) => /^https:\/\/docs\.google\.com\/document\/d\/([\w-]{20,})/.exec(url)?.[1] ?? null;
export const rulesView = (url: string) => {
  const id = googleDocId(url);
  return id ? `https://docs.google.com/document/d/${id}/preview` : null; // null: can't be shown inside the page
};
export const rulesPrint = (url: string) => {
  const id = googleDocId(url);
  return id ? `https://docs.google.com/document/d/${id}/export?format=pdf` : url;
};
export const cleanRulesUrl = (v: unknown): string | null | false => {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return false;
  const u = v.trim();
  if (u.length > 500 || !/^https:\/\/[^\s<>"]+$/.test(u)) return false;
  return u;
};
