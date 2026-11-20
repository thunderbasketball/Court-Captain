"use client";

import { useEffect } from "react";
import { BRAND_KEY } from "./Splash";

// Remembers on this phone the organization being looked at (its logo and name), for the loading screen (app/Splash.tsx).
export default function RememberBrand({ logo, name }: { logo: string | null; name: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify({ logo, name }));
    } catch {
      // Private browsing or storage blocked: the loading screen shows CourtCaptain's logo.
    }
  }, [logo, name]);
  return null;
}
