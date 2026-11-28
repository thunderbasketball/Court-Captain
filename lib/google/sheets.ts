// Reads Google Sheets as the app's service account (thunder-sheets@...). Each sheet must be shared with the account's email.
// The key: GOOGLE_SERVICE_ACCOUNT_JSON (the key file's contents, or that base64-encoded; for hosts like Netlify, which
// don't have data/), else the key file in data/ (gitignored).
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export type ServiceAccount = { client_email: string; private_key: string };

export const READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function loadServiceAccount(
  file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "data/google-service-account.json",
  json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
): ServiceAccount {
  let key: Partial<ServiceAccount>;
  if (json?.trim()) {
    const text = json.trim().startsWith("{") ? json : Buffer.from(json, "base64").toString("utf8");
    try {
      key = JSON.parse(text);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid (paste the whole key file, or it base64-encoded).");
    }
    if (!key.client_email || !key.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't a service account key.");
    return key as ServiceAccount;
  }
  try {
    // Read at runtime only; keeps the build from bundling the project folder (and data/) into the server output.
    key = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
  } catch {
    throw new Error(`Can't read the Google key file at ${file}.`);
  }
  if (!key.client_email || !key.private_key) throw new Error(`${file} isn't a service account key.`);
  return key as ServiceAccount;
}

// Accepts a full sheet link or a bare spreadsheet ID.
export function spreadsheetIdOf(linkOrId: string): string {
  const m = linkOrId.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : linkOrId.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error("That doesn't look like a Google Sheet link.");
  return id;
}

type Deps = { key: ServiceAccount; fetch?: typeof fetch; now?: () => Date };

const tokens = new Map<string, { token: string; expires: number }>();

export async function accessToken({ key, fetch: f = fetch, now = () => new Date() }: Deps, scope: string): Promise<string> {
  const t = now().getTime();
  const cacheKey = `${key.client_email} ${scope}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > t + 60_000) return cached.token;

  const iat = Math.floor(t / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
  tokens.set(cacheKey, { token: body.access_token, expires: t + body.expires_in * 1000 });
  return body.access_token;
}

// Returns the tab's cells as text, exactly as the sheet displays them. Row 1 is the header.
export async function readTab(deps: Deps, spreadsheetId: string, tab: string): Promise<string[][]> {
  const token = await accessToken(deps, READ_SCOPE);
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const res = await (deps.fetch ?? fetch)(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = await res.json();
  if (res.status === 403 || res.status === 404)
    throw new Error(`Can't open that sheet. Share it with ${deps.key.client_email} (Viewer).`);
  if (res.status === 400 && /parse range/i.test(body.error?.message ?? ""))
    throw new Error(`The sheet has no tab named "${tab}".`);
  if (!res.ok) throw new Error(`Google Sheets error: ${body.error?.message ?? res.status}`);
  return (body.values ?? []).map((r: unknown[]) => r.map((c) => String(c ?? "")));
}
