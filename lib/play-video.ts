// CourtPlaybook video links (browser-safe; saved by lib/playbook.ts): a play's examples of it being run. YouTube and
// Vimeo links play in the app (their own players, built from the video's id only); a video file (.mp4, .webm, .mov)
// plays in a <video>; any other link opens in a new tab.
export const MAX_VIDEOS = 5;

export type VideoPlayer =
  | { kind: "youtube" | "vimeo"; src: string; label: string }
  | { kind: "file"; src: string; label: string }
  | { kind: "link"; src: string; label: string };

// A link typed in, checked: http or https, up to 500 letters. Null when it isn't a web address.
export function cleanVideoUrl(v: string): string | null {
  const t = v.trim();
  if (!t || t.length > 500) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// "1m30s", "90" or "90s" → seconds.
function seconds(t: string | null): number {
  if (!t) return 0;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

export function videoPlayer(url: string): VideoPlayer {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "link", src: url, label: url };
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const label = host;
  const id = /^[\w-]{6,20}$/;
  let yt: string | null = null;
  if (host === "youtu.be") yt = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    yt = u.searchParams.get("v") ?? (/^\/(shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[2] ?? null);
  }
  if (yt && id.test(yt)) {
    const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ""}`, label: "YouTube" };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = /\/(\d{5,12})(?:\/|$)/.exec(u.pathname)?.[1];
    if (v) return { kind: "vimeo", src: `https://player.vimeo.com/video/${v}`, label: "Vimeo" };
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString(), label };
  return { kind: "link", src: u.toString(), label };
}
