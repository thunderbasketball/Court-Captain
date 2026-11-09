import { db } from "@/lib/db";

// A program's uploaded logo (SPEC.md section 13). Public: it's shown on the login page's events and the public League
// page. The ?v= in the link changes when the logo does, so it can be cached for a long time.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = await db.query<{ logo: Buffer | null; logo_type: string | null }>(
    "select logo, logo_type from scenic_programs where id = $1",
    [id],
  );
  const row = r.rows[0];
  if (!row?.logo || !row.logo_type) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.logo), {
    headers: {
      "Content-Type": row.logo_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
