import { describe, expect, it } from "vitest";
import { cleanVideoUrl, videoPlayer } from "./play-video";

describe("CourtPlaybook video links", () => {
  it("keeps web links only (http or https), adding https:// when left off", () => {
    expect(cleanVideoUrl(" youtu.be/dQw4w9WgXcQ ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(cleanVideoUrl("http://example.com/a.mp4")).toBe("http://example.com/a.mp4");
    for (const bad of ["", "javascript:alert(1)", "notalink", "ftp://x.com/a", "x".repeat(501)]) expect(cleanVideoUrl(bad)).toBeNull();
  });

  it("YouTube and Vimeo play in their players (built from the id only); files in a video; others open in a new tab", () => {
    expect(videoPlayer("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toMatchObject({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
    });
    expect(videoPlayer("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(videoPlayer("https://youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube" });
    expect(videoPlayer("https://vimeo.com/123456789")).toMatchObject({ kind: "vimeo", src: "https://player.vimeo.com/video/123456789" });
    expect(videoPlayer("https://cdn.example.com/plays/horns.mp4")).toMatchObject({ kind: "file" });
    expect(videoPlayer("https://www.hudl.com/video/3/123/abc")).toMatchObject({ kind: "link", label: "hudl.com" });
    // A YouTube link with a strange id isn't embedded.
    expect(videoPlayer('https://youtube.com/watch?v="><script>')).toMatchObject({ kind: "link" });
  });
});
