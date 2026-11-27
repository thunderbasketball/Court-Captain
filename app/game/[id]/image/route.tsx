import { db } from "@/lib/db";
import { gameCard, type GameSide } from "@/lib/game-share";
import { orgInfo, type Org } from "@/lib/org-registry";
import { ACCENT, LogoTile, column, picture, pictureLogo, sizeFor } from "@/lib/picture";
import { publicly } from "@/lib/public-cache";
import { timeLabel } from "@/lib/time";

const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

// A game coming up, as a picture to hype it (SPEC.md section 13), public: square for Instagram, Facebook and X; ?shape=wide
// for a link's preview. Both teams with their organizations' logos, away and home, the day, time and gym, and the League.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicly(`game:${id.slice(0, 20)}`, () => gameCard(db, id));
  const o = card && (await orgInfo(db, card.org));
  if (!card || !o) return new Response("Not found", { status: 404 });
  const wide = new URL(req.url).searchParams.get("shape") === "wide";
  const [leagueLogo, away, home] = await Promise.all([pictureLogo(o), teamLogo(card.away, o), teamLogo(card.home, o)]);
  const tile = wide ? 150 : 230;
  // Each name on two lines (the coach's last name 2nd), both the same size: the size the longest line needs.
  const lines = [...card.away.lines, ...card.home.lines];
  const nameSize = sizeFor(lines.reduce((a, b) => (b.length > a.length ? b : a), ""), wide ? 40 : 50);
  const team = (t: GameSide, x: { logo: string | null; o: Org }, label: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: wide ? 420 : 400, gap: wide ? 12 : 18 }}>
      <LogoTile logo={x.logo} o={x.o} size={tile} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", fontFamily: "Bold", fontSize: nameSize, lineHeight: 1.1, maxHeight: wide ? 100 : 170, overflow: "hidden" }}>
        {t.lines.map((l, i) => (
          <div key={i} style={{ display: "flex" }}>
            {l}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", padding: "4px 18px", borderRadius: 999, fontFamily: "Bold", fontSize: wide ? 22 : 28, background: label === "HOME" ? ACCENT : "rgba(255,255,255,0.15)", color: "#ffffff" }}>
        {label}
      </div>
    </div>
  );
  return picture(
    o,
    wide,
    <div style={column}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <LogoTile logo={leagueLogo} o={o} size={wide ? 90 : 130} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 58 : 84, lineHeight: 1, color: ACCENT }}>GAME DAY</div>
          <div style={{ display: "flex", fontSize: wide ? 30 : 40, marginTop: 6 }}>{card.group}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        {team(card.away, away, "AWAY")}
        <div style={{ display: "flex", marginTop: tile / 2 - (wide ? 40 : 55), fontFamily: "Bold", fontSize: wide ? 64 : 90, color: "rgba(255,255,255,0.9)" }}>VS</div>
        {team(card.home, home, "HOME")}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: wide ? 26 : 34 }}>
          <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 34 : 44 }}>{`${dateLabel(card.day)} · ${timeLabel(card.starts)}`}</div>
          {card.gym && <div style={{ display: "flex" }}>{card.court && card.court !== "Main" ? `${card.gym}, ${card.court}` : card.gym}</div>}
          <div style={{ display: "flex", color: "rgba(255,255,255,0.75)" }}>{`${o.name} · ${card.program}`}</div>
        </div>
        {!wide && <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.75)" }}>CourtCaptain</div>}
      </div>
    </div>,
  );
}

// A team's organization logo (its letter on a tile when it has no organization in the app, or no logo).
async function teamLogo(t: GameSide, league: Org): Promise<{ logo: string | null; o: Org }> {
  const own = t.org ? await orgInfo(db, t.org) : null;
  if (own) return { logo: await pictureLogo(own), o: own };
  return { logo: null, o: { ...league, name: t.from || t.name } };
}
