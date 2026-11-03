import "server-only";
import { redirect } from "next/navigation";
import { db } from "./db";

// An old address of a renamed organization (SPEC.md section 14) goes to the same page at its new one.
export async function followRename(slug: string, path: (slug: string) => string): Promise<void> {
  const r = await db.query<{ slug: string }>(
    "select slug from org_old_slugs where old_slug = $1 and not exists (select 1 from organizations where slug = $1)",
    [slug],
  );
  if (r.rows[0]) redirect(path(r.rows[0].slug));
}
