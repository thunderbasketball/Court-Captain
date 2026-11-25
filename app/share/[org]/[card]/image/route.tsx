import { findCard } from "@/lib/public-facts";
import { ACCENT, LogoTile, column, picture, pictureLogo, publicAddress, sizeFor } from "@/lib/picture";

// A share picture (SPEC.md section 14), public: square, or ?shape=wide for a link's preview. Everything in it is read here;
// nothing comes from the address but which picture.
export async function GET(req: Request, { params }: { params: Promise<{ org: string; card: string }> }) {
  const { org, card: key } = await params;
  const hit = await findCard(org, key, new Date());
  if (!hit) return new Response("Not found", { status: 404 });
  const { org: o, card: c } = hit;
  const wide = new URL(req.url).searchParams.get("shape") === "wide";
  const logo = await pictureLogo(o);
  const max = wide ? (c.big ? 1 : 4) : c.big ? 3 : 9;
  const lines = c.lines.length > max ? c.lines.slice(0, max - 1) : c.lines;
  const more = c.lines.length - lines.length;
  const address = publicAddress(o.slug) ?? o.name;
  const tall = !wide && c.foot.length + address.length > 56;
  const many = lines.length + (more ? 1 : 0) > 4;
  const rowSize = wide ? 30 : many ? 34 : 44;
  const row = (l: { text: string; side?: string }, i: number) => (
    <div
      key={i}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: wide ? "9px 22px" : many ? "11px 28px" : "20px 32px",
        borderRadius: 18,
        background: "rgba(255,255,255,0.12)",
      }}
    >
      <div style={{ display: "flex", flexShrink: 1, fontFamily: "Bold", fontSize: l.text.length > 44 ? rowSize * 0.72 : l.text.length > 30 ? rowSize * 0.84 : rowSize, lineHeight: 1.15 }}>{l.text}</div>
      {l.side !== undefined && <div style={{ display: "flex", flexShrink: 0, marginLeft: 24, fontFamily: "Bold", fontSize: rowSize, color: ACCENT }}>{l.side}</div>}
    </div>
  );
  return picture(
    o,
    wide,
    <div style={column}>
      <div style={{ display: "flex", alignItems: "center", gap: wide ? 28 : 36 }}>
        <LogoTile logo={logo} o={o} size={wide ? 110 : 170} />
        <div style={{ display: "flex", flexDirection: "column", maxWidth: wide ? 960 : 740 }}>
          <div style={{ display: "flex", fontSize: sizeFor(c.kicker, wide ? 34 : 46), color: ACCENT }}>{c.kicker}</div>
          <div style={{ display: "flex", fontFamily: "Bold", fontSize: c.title.length <= 16 ? (wide ? 68 : 88) : wide ? 56 : 72, lineHeight: 1.05, marginTop: 8 }}>{c.title}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: wide ? 10 : many ? 12 : 18 }}>
        {c.big && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
            <div style={{ display: "flex", flexShrink: 0, fontFamily: "Bold", fontSize: wide ? 210 : c.big.value.length > 2 ? 300 : 380, lineHeight: 0.9 }}>{c.big.value}</div>
            <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 48 : 64, marginBottom: wide ? 14 : 34, color: ACCENT }}>{c.big.label}</div>
          </div>
        )}
        {c.tiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: wide ? "row" : "column", gap: 18 }}>
            {c.tiles.map((t) => (
              <div key={t.label} style={{ display: "flex", flexGrow: 1, alignItems: wide ? "center" : "center", flexDirection: wide ? "column" : "row", gap: wide ? 0 : 32, padding: wide ? "20px" : "22px 36px", borderRadius: 24, background: "rgba(255,255,255,0.12)" }}>
                <div style={{ display: "flex", fontFamily: "Bold", fontSize: wide ? 96 : 120, lineHeight: 1 }}>{String(t.value)}</div>
                <div style={{ display: "flex", fontSize: wide ? 34 : 54, color: ACCENT }}>{t.label}</div>
              </div>
            ))}
          </div>
        )}
        {lines.map(row)}
        {more > 0 && <div style={{ display: "flex", padding: "0 28px", fontSize: rowSize * 0.85, color: "rgba(255,255,255,0.85)" }}>{`+ ${more} more`}</div>}
      </div>
      {/* The button and the address: side by side, or the address under it when the two don't fit on one line. */}
      <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: 16, justifyContent: "space-between", alignItems: tall ? "flex-start" : "center", fontSize: wide ? 24 : 30 }}>
        <div style={{ display: "flex", flexShrink: 0, padding: wide ? "10px 24px" : "14px 30px", borderRadius: 999, background: "#ffffff", color: "#0b1020", fontFamily: "Bold" }}>{c.foot}</div>
        <div style={{ display: "flex", flexShrink: 0, color: "rgba(255,255,255,0.9)", fontSize: address.length > 54 ? 24 : wide ? 24 : 30 }}>{address}</div>
      </div>
    </div>,
  );
}
