"use client";

import { useEffect } from "react";
import { BRAND_KEY, logoCss } from "@/lib/brand-script";

// The first screen while a page loads (instead of a blank white one): the organization's logo, "powered by CourtCaptain"
// under it; just the CourtCaptain logo when the organization has none (or on a first visit). The logo is the one this
// phone saw last (app/RememberBrand.tsx keeps it), set on <html> by a small script in the page's head (lib/brand-script)
// as the page arrives, before the app's code loads; no script here (React won't run one inside a component).
const CC = "/brand/courtcaptain-192.png";

export default function Splash() {
  // A page reached inside the app: the logo may have changed since the page first loaded, so mark <html> again.
  useEffect(() => {
    const h = document.documentElement;
    try {
      const b = JSON.parse(localStorage.getItem(BRAND_KEY) || "null") as { logo?: unknown } | null;
      const css = logoCss(b?.logo);
      if (css) {
        h.style.setProperty("--cc-org-logo", css);
        h.setAttribute("data-brand", "org");
        return;
      }
    } catch {
      // Storage blocked: CourtCaptain's logo.
    }
    h.setAttribute("data-brand", "cc");
  }, []);
  const org = "hidden [html[data-brand=org]_&]:block";
  return (
    <div className="flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-4 px-4" role="status" aria-label="Loading">
      {/* The organization's logo (from <html>'s --cc-org-logo). */}
      <div aria-hidden className={`${org} h-24 w-[70vw] max-w-xs bg-contain bg-center bg-no-repeat [background-image:var(--cc-org-logo)]`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- shown before the app loads */}
      <img alt="CourtCaptain" src={CC} className="h-20 w-auto [html[data-brand=org]_&]:hidden" />
      <span className="hidden items-center gap-1.5 text-xs font-medium text-zinc-500 [html[data-brand=org]_&]:flex">
        powered by
        {/* eslint-disable-next-line @next/next/no-img-element -- small brand mark */}
        <img alt="" src={CC} className="h-5 w-auto" />
        <span className="font-semibold text-thunder-orange">CourtCaptain</span>
      </span>
      <span aria-hidden className="mt-2 size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-thunder-orange" />
    </div>
  );
}
