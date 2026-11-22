// The loading screen's logo (app/Splash.tsx): the organization this phone saw last (app/RememberBrand.tsx keeps it).
// BRAND_SCRIPT runs once in the page's head as it arrives, before the app's code: it marks <html> data-brand="org" with
// the logo as the --cc-org-logo CSS variable (only a path on this site), else data-brand="cc" (CourtCaptain's logo).
export const BRAND_KEY = "cc_brand";

// The CSS value for a remembered logo, or null when it isn't a path on this site.
export const logoCss = (logo: unknown) =>
  typeof logo === "string" && logo.startsWith("/") && !logo.startsWith("//") ? `url("${logo.replace(/["\\\n\r]/g, "")}")` : null;

export const BRAND_SCRIPT = `(function(){var h=document.documentElement;try{var b=JSON.parse(localStorage.getItem("${BRAND_KEY}")||"null");
var l=b&&b.logo;if(typeof l==="string"&&l.charAt(0)==="/"&&l.charAt(1)!=="/"){h.style.setProperty("--cc-org-logo",'url("'+l.replace(/["\\\\\\n\\r]/g,"")+'")');h.setAttribute("data-brand","org");return;}}catch(e){}
h.setAttribute("data-brand","cc");})();`;
