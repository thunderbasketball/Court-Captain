import { db } from "@/lib/db";

// A League's rules PDF (SPEC.md section 13), opened from a hosting organization's Documents card. Public like the
// program's logo: rules are shared with coaches, referees and gyms.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = await db.query<{ rules: Buffer | null; rules_name: string | null }>("select rules, rules_name from scenic_programs where id = $1", [id]);
  const row = r.rows[0];
  if (!row?.rules) return new Response("Not found", { status: 404 });
  const name = (row.rules_name ?? "Rules.pdf").replace(/[^\w .,()-]/g, "_");
  return new Response(new Uint8Array(row.rules), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
