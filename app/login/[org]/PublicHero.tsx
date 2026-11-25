import Image from "next/image";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Hero } from "@/lib/public-org";
import OrgLogo from "../../OrgLogo";
import ShareButton from "../../ShareButton";

// The banner on every organization's main page: its logo, name and the most inviting thing true today, over a dark court
// lit in its color (dark so white text reads on any color), with its buttons, Share and its season numbers.
export default function PublicHero({
  org,
  name,
  color,
  logo,
  hero,
  children,
}: {
  org: string;
  name: string;
  color: string;
  logo: string | null;
  hero: Hero;
  children?: ReactNode; // logged in: Open <name> →
}) {
  return (
    <header
      className="relative isolate overflow-hidden rounded-3xl text-white shadow-lg"
      style={{
        background: `linear-gradient(90deg, rgba(9,13,26,.82) 0%, rgba(9,13,26,.35) 60%, rgba(9,13,26,.1) 100%), radial-gradient(75% 150% at 100% 0%, ${color} 0%, transparent 72%), radial-gradient(60% 120% at 0% 110%, ${color}88 0%, transparent 70%), #0b1020`,
      }}
    >
      <CourtLines />
      <div className="absolute top-3 right-3">
        <ShareButton path={`/login/${org}`} title={name} label={`Share ${name}`} className="!text-white ring-1 ring-white/40 hover:!bg-white/15" />
      </div>
      <div className="flex flex-col items-center gap-5 px-5 pt-8 pb-6 text-center sm:flex-row sm:gap-7 sm:px-8 sm:py-9 sm:text-left">
        <span className="shrink-0 rounded-3xl bg-white p-3 shadow-xl ring-1 ring-black/10">
          <OrgLogo src={logo} name={name} color={color} className="size-28 rounded-2xl text-5xl lg:size-36" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-balance lg:text-5xl">{name}</h1>
          <p className="mt-2 text-base font-medium text-balance text-white/90 lg:text-lg">{hero.line}</p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-white/75 sm:justify-start">
            Powered by
            <Image src="/brand/courtcaptain-192.png" alt="" width={192} height={128} className="h-4 w-auto" />
            <span className="font-semibold text-white">CourtCaptain</span>
          </p>
          {(hero.actions.length > 0 || children) && (
            <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              {children}
              {hero.actions.map((a, i) => {
                const cls =
                  i === 0 && !children
                    ? "rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow hover:bg-white/90"
                    : "rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/40 ring-inset hover:bg-white/20";
                return a.href.startsWith("#") ? (
                  <a key={a.href} href={a.href} className={cls}>
                    {a.label}
                  </a>
                ) : (
                  <Link key={a.href} href={a.href} className={cls}>
                    {a.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {hero.stats.length > 0 && (
        <dl className="flex border-t border-white/15 bg-black/30">
          {hero.stats.map((x) => (
            <div key={x.label} className="flex min-w-0 flex-1 flex-col-reverse items-center border-l border-white/10 px-1 py-3 text-center first:border-l-0">
              <dt className="text-[11px] font-medium text-white/80 sm:text-sm">{x.label}</dt>
              <dd className="text-2xl font-bold tabular-nums lg:text-3xl">{x.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

// A half court drawn faintly behind the banner.
const CourtLines = () => (
  <svg
    aria-hidden
    viewBox="0 0 500 470"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    className="pointer-events-none absolute -top-10 -right-24 -z-10 h-[150%] text-white/15 sm:right-0"
  >
    <path d="M30 0v140a220 220 0 0 0 440 0V0" />
    <path d="M170 0v190h160V0" />
    <circle cx="250" cy="190" r="60" />
    <path d="M220 40h60" />
    <circle cx="250" cy="52" r="10" />
    <path d="M190 470a60 60 0 0 1 120 0" />
  </svg>
);
