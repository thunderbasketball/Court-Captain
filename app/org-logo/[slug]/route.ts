import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";

// An organization's uploaded logo (SPEC.md section 14). Public: it's shown on its login link. The ?v= in the link changes
// when the logo does, so it can be cached for a long time.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isOrgSlug(slug)) return new Response("Not found", { status: 404 });
  const r = await db.query<{ logo: Buffer | null; logo_type: string | null }>("select logo, logo_type from organizations where slug = $1", [slug]);
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
