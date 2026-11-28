import "server-only";
// What every share picture is drawn with (app/score, app/share): the app's own font, the organization's logo, and a dark
// court lit in its color.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { db } from "./db";
import type { Org } from "./org-registry";
import { publicly } from "./public-cache";

const bold = readFile(join(process.cwd(), "assets/fonts/Geist-ExtraBold.ttf"));
const medium = readFile(join(process.cwd(), "assets/fonts/Geist-Medium.ttf"));
bold.catch(() => {});
medium.catch(() => {});

export const ACCENT = "#f5883d"; // CourtCaptain's orange, a little lighter on the dark court
const COURT = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 470" width="1000" height="940" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"><path d="M30 0v140a220 220 0 0 0 440 0V0"/><path d="M170 0v190h160V0"/><circle cx="250" cy="190" r="60"/><path d="M220 40h60"/><circle cx="250" cy="52" r="10"/></svg>`,
).toString("base64")}`;

// A WebP logo as PNG (the picture maker doesn't read WebP), with the converter Next brings; null where it isn't there.
async function asPng(bytes: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(bytes).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

// The organization's logo, right in the picture (its letter when it has none that can be drawn).
async function readLogo(org: string, path: string | null): Promise<string | null> {
  const r = await db.query<{ logo: Buffer | null; logo_type: string | null }>("select logo, logo_type from organizations where slug = $1", [org]);
  const up = r.rows[0];
  if (up?.logo) {
    if (up.logo_type === "image/png" || up.logo_type === "image/jpeg") return `data:${up.logo_type};base64,${up.logo.toString("base64")}`;
    const png = await asPng(up.logo);
    return png && `data:image/png;base64,${png.toString("base64")}`;
  }
  const file = path?.match(/^\/brand\/([\w-]+\.png)$/)?.[1];
  if (!file) return null;
  const bytes = await readFile(join(process.cwd(), "public/brand", file)).catch(() => null);
  return bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null;
}
// A team's own logo (lib/team-logos), right in the picture; null when it has none that can be drawn.
export async function teamPictureLogo(key: string): Promise<string | null> {
  const r = await db.query<{ logo: Buffer; logo_type: string }>("select logo, logo_type from team_logos where team_key = $1", [key]);
  const up = r.rows[0];
  if (!up) return null;
  if (up.logo_type === "image/png" || up.logo_type === "image/jpeg") return `data:${up.logo_type};base64,${up.logo.toString("base64")}`;
  const png = await asPng(up.logo);
  return png && `data:image/png;base64,${png.toString("base64")}`;
}
export const pictureLogo = (o: Org) => publicly(`picture-logo:${o.slug}:${o.bigLogo ?? ""}`, () => readLogo(o.slug, o.bigLogo));

export function LogoTile({ logo, o, size }: { logo: string | null; o: Org; size: number }) {
  return (
    <div style={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size / 6, background: "#ffffff", color: o.color }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- drawn into the picture
        <img src={logo} width={size - 24} height={size - 24} style={{ objectFit: "contain" }} />
      ) : (
        <div style={{ display: "flex", fontFamily: "Bold", fontSize: size / 2 }}>{o.name.trim().charAt(0).toUpperCase()}</div>
      )}
    </div>
  );
}

// Long words get smaller letters.
export const sizeFor = (text: string, big: number) => Math.round(text.length <= 16 ? big : text.length <= 24 ? big * 0.8 : text.length <= 34 ? big * 0.64 : big * 0.5);

// A picture's parts, top to bottom (the picture maker lays a bare fragment out as a row).
export const column = { display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%" } as const;

// Square for Instagram, Facebook and X; wide for a link's preview; tall (a phone's screen, Stories) for many games.
export async function picture(o: Org, wide: boolean, inside: ReactNode, tall = false): Promise<ImageResponse> {
  const el: ReactElement = (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        color: "#ffffff",
        fontFamily: "Medium",
        backgroundColor: "#0b1020",
        backgroundImage: `linear-gradient(135deg, #0b1020 40%, ${o.color}99 100%)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- drawn into the picture */}
      <img src={COURT} width={wide ? 780 : 1000} height={wide ? 733 : 940} style={{ position: "absolute", top: 0, right: wide ? -120 : -320 }} />
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", padding: wide ? 44 : 64 }}>{inside}</div>
    </div>
  );
  return new ImageResponse(el, {
    width: wide ? 1200 : 1080,
    height: wide ? 630 : tall ? 1920 : 1080,
    fonts: [
      { name: "Bold", data: await bold, weight: 800, style: "normal" },
      { name: "Medium", data: await medium, weight: 500, style: "normal" },
    ],
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60", "X-Content-Type-Options": "nosniff" },
  });
}

// The organization's public address as people would type it, on the live site only.
export function publicAddress(org: string): string | null {
  const url = process.env.APP_URL ?? "";
  if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) return null;
  return `${new URL(url).host.replace(/^www\./, "")}/login/${org}`;
}
