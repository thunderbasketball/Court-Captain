import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { LogoTile, column, picture, pictureLogo, sizeFor } from "@/lib/picture";
import { publicly } from "@/lib/public-cache";
import { scoreCard } from "@/lib/score-share";

const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

// A final score's picture (SPEC.md section 13), public: square for Instagram, Facebook and X; ?shape=wide for a link's
// preview. Nothing in it comes from the address but the game's number.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicly(`score:${id.slice(0, 20)}`, () => scoreCard(db, new Date(), id));
  const o = card && (await orgInfo(db, card.org));
  if (!card || !o) return new Response("Not found", { status: 404 });
  const wide = new URL(req.url).searchParams.get("shape") === "wide";
  const logo = await pictureLogo(o);
  // Both names the same size: the size the longer one needs.
  const longer = card.winner.name.length >= card.loser.name.length ? card.winner.name : card.loser.name;
  const nameSize = sizeFor(longer, wide ? 58 : 68);
  const row = (t: { name: string; score: number }, won: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: wide ? "16px 32px" : "34px 40px",
        borderRadius: 28,
        background: won ? "#ffffff" : "rgba(255,255,255,0.1)",
        color: won ? "#0b1020" : "#ffffff",
      }}
    >
      <div style={{ display: "flex", maxWidth: wide ? 820 : 700, fontFamily: "Bold", fontSize: nameSize, lineHeight: 1.1, overflow: "hidden", maxHeight: wide ? 130 : 155 }}>
        {t.name}
      </div>
      <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 100 : 136, lineHeight: 1 }}>{String(t.score)}</div>
    </div>
  );
  return picture(
    o,
    wide,
    <div style={column}>
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <LogoTile logo={logo} o={o} size={wide ? 120 : 190} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 60 : 92, lineHeight: 1 }}>FINAL</div>
          <div style={{ display: "flex", fontSize: wide ? 34 : 48, marginTop: 8 }}>{card.group}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: wide ? 14 : 24 }}>
        {row(card.winner, true)}
        {row(card.loser, false)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: wide ? 24 : 32, color: "rgba(255,255,255,0.85)" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>{`${o.name} · ${card.program}`}</div>
          <div style={{ display: "flex" }}>{dateLabel(card.day)}</div>
        </div>
        {!wide && <div style={{ display: "flex", fontSize: 24 }}>CourtCaptain</div>}
      </div>
    </div>,
  );
}
