import { db } from "@/lib/db";

// A team's uploaded logo (SPEC.md section 13). Public: it's drawn on the team's Game Day pictures. The ?v= in the link
// changes when the logo does, so it can be cached for a long time. key: "t-12", "o-3" or "s-40".
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[tos]-\d{1,18}$/.test(key)) return new Response("Not found", { status: 404 });
  const r = await db.query<{ logo: Buffer; logo_type: string }>("select logo, logo_type from team_logos where team_key = $1", [key.replace("-", ":")]);
  const row = r.rows[0];
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.logo), {
    headers: { "Content-Type": row.logo_type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
