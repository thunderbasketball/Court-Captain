// Reads FastBreak Compete's Tenant API (read-only): events and their registered teams. Settings in .env.local:
// FASTBREAK_DOMAIN (sceniccity.fastbreakcompete.ai) and FASTBREAK_API_KEY (never printed). Players are never asked for.

export type FbEvent = {
  id: number;
  name: string;
  type: string; // single-day | multi-day | super-event | league
  start: string; // YYYY-MM-DD
  end: string;
  archived: boolean;
  sportId: number;
};
export type FbStaff = { firstName: string; lastName: string; title: string; email: string | null; phone: string | null };
export type FbTeam = {
  id: number;
  name: string;
  genderId: number; // 1 Boys, 2 Girls, 3 Boys & Girls
  grade: number;
  organizationId: number | null;
  organizationName: string | null;
  staff?: FbStaff[];
};

export type FastbreakClient = { events(): Promise<FbEvent[]>; teams(eventId: number): Promise<FbTeam[]> };

export function fastbreakConfigured() {
  return !!process.env.FASTBREAK_DOMAIN && !!process.env.FASTBREAK_API_KEY;
}

export function fastbreakClient(): FastbreakClient {
  const domain = (process.env.FASTBREAK_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const key = process.env.FASTBREAK_API_KEY ?? "";
  if (!/^[a-z0-9.-]+$/i.test(domain) || !key) throw new Error("Fastbreak isn't set up (FASTBREAK_DOMAIN, FASTBREAK_API_KEY).");

  // Every page of a list (1000 a page).
  async function all<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const url = new URL(`https://${domain}/tenant/api/v1/${path}`);
      for (const [k, v] of Object.entries({ ...params, page, pageSize: 1000 })) url.searchParams.set(k, String(v));
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Fastbreak ${path}: ${res.status === 401 ? "the API key was refused" : `HTTP ${res.status}`}`);
      const body = (await res.json()) as { items?: T[]; pagination?: { total?: number } };
      const got = Array.isArray(body.items) ? body.items : [];
      items.push(...got);
      if (got.length < 1000 || items.length >= (body.pagination?.total ?? 0)) break;
    }
    return items;
  }

  return { events: () => all<FbEvent>("events", { sportId: 2 }), teams: (eventId) => all<FbTeam>("teams", { eventId }) };
}
