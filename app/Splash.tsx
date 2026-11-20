"use client";

import { useEffect } from "react";

// The first screen while a page loads (instead of a blank white one): the organization's logo, "powered by CourtCaptain"
// under it; just the CourtCaptain logo when the organization has none (or on a first visit). The logo is the one this
// phone saw last (app/RememberBrand.tsx keeps it), set by a small script as the page arrives, before the app's code loads.
export const BRAND_KEY = "cc_brand";
const CC = "/brand/courtcaptain-192.png";

const PICK = `(function(){try{var b=JSON.parse(localStorage.getItem("${BRAND_KEY}")||"null");var s=document.getElementById("cc-splash");if(!s)return;
if(b&&typeof b.logo==="string"&&b.logo.charAt(0)==="/"&&b.logo.charAt(1)!=="/"){s.querySelector("[data-org]").setAttribute("src",b.logo);
s.querySelector("[data-org]").setAttribute("alt",String(b.name||""));s.setAttribute("data-brand","org");}else{s.setAttribute("data-brand","cc");}}catch(e){var t=document.getElementById("cc-splash");if(t)t.setAttribute("data-brand","cc");}})();`;

export default function Splash() {
  // A page reached inside the app (no fresh load): the script above doesn't run again, so pick here too.
  useEffect(() => {
    const s = document.getElementById("cc-splash");
    const img = s?.querySelector("[data-org]");
    if (!s || !img) return;
    try {
      const b = JSON.parse(localStorage.getItem(BRAND_KEY) || "null") as { logo?: unknown; name?: unknown } | null;
      if (b && typeof b.logo === "string" && b.logo.startsWith("/") && !b.logo.startsWith("//")) {
        img.setAttribute("src", b.logo);
        img.setAttribute("alt", String(b.name ?? ""));
        s.setAttribute("data-brand", "org");
        return;
      }
    } catch {
      // Storage blocked: CourtCaptain's logo.
    }
    s.setAttribute("data-brand", "cc");
  }, []);
  return (
    <div
      id="cc-splash"
      data-brand=""
      suppressHydrationWarning
      className="group flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-4 px-4"
      role="status"
      aria-label="Loading"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- set before the app loads */}
      <img data-org alt="" src={CC} suppressHydrationWarning className="hidden h-24 w-auto max-w-[70vw] object-contain group-data-[brand=org]:block" />
      {/* eslint-disable-next-line @next/next/no-img-element -- set before the app loads */}
      <img alt="CourtCaptain" src={CC} className="hidden h-20 w-auto group-data-[brand=cc]:block" />
      <span className="hidden items-center gap-1.5 text-xs font-medium text-zinc-500 group-data-[brand=org]:flex">
        powered by
        {/* eslint-disable-next-line @next/next/no-img-element -- small brand mark */}
        <img alt="" src={CC} className="h-5 w-auto" />
        <span className="font-semibold text-thunder-orange">CourtCaptain</span>
      </span>
      <span aria-hidden className="mt-2 size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-thunder-orange" />
      <script dangerouslySetInnerHTML={{ __html: PICK }} />
    </div>
  );
}
