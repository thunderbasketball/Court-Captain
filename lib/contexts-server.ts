import "server-only";
import { cookies } from "next/headers";
import type { SessionUser } from "./auth/service";
import { CONTEXT_COOKIE, pickContext, userContexts, type RoleContext } from "./contexts";
import { db } from "./db";
import type { ScenicRole } from "./orgs";

// The viewer's roles, and which one they used last (falls back to their first).
export async function currentContexts(user: SessionUser): Promise<{ contexts: RoleContext[]; active: RoleContext | null }> {
  const contexts = await userContexts(db, user);
  const remembered = (await cookies()).get(CONTEXT_COOKIE)?.value;
  return { contexts, active: pickContext(contexts, remembered) };
}

// The Scenic City role a page is shown as: the Scenic City chip used last, else the person's highest Scenic City role.
// Null when they hold no Scenic City role. Only ever narrows what the server already allows for that person.
export async function currentScenic(user: SessionUser): Promise<{ key: string; role: ScenicRole } | null> {
  const { contexts, active } = await currentContexts(user);
  const c = active?.org === "scenic-city" ? active : contexts.find((x) => x.org === "scenic-city");
  return c && "role" in c && c.org === "scenic-city" ? { key: c.key, role: c.role as ScenicRole } : null;
}
