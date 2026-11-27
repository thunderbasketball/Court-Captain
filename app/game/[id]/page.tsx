import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { gameCard, gameText } from "@/lib/game-share";
import { orgInfo } from "@/lib/org-registry";
import { publicly } from "@/lib/public-cache";

// Read when someone asks (never while the site is built: whether it's shown depends on the schedule).
const read = async (id: string) => {
  await connection();
  return publicly(`game:${id.slice(0, 20)}`, () => gameCard(db, id));
};

// A shared link's preview: the game and its picture.
export async function generateMetadata({ params }: PageProps<"/game/[id]">): Promise<Metadata> {
  const { id } = await params;
  const card = await read(id);
  if (!card) return {};
  const title = gameText(card);
  const image = { url: `/game/${card.id}/image?shape=wide&v=${card.day}-${card.starts}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description: card.program,
    metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
    openGraph: { title, description: card.program, url: `/game/${card.id}`, siteName: "CourtCaptain", images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

// One game's public page (no login): where a shared link leads. Its picture, and on to the League's organization.
export default function GamePage({ params }: PageProps<"/game/[id]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Game params={params} />
      </Suspense>
    </main>
  );
}

async function Game({ params }: { params: PageProps<"/game/[id]">["params"] }) {
  const { id } = await params;
  const card = await read(id);
  const o = card && (await orgInfo(db, card.org));
  if (!card || !o) notFound();
  return (
    <>
      <h1 className="sr-only">{gameText(card)}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on the fly */}
      <img src={`/game/${card.id}/image?v=${card.day}-${card.starts}`} alt={gameText(card)} width={1080} height={1080} className="w-full rounded-2xl shadow-lg" />
      <Link href={`/league/${o.slug}`} className="mt-4 block rounded-xl bg-thunder-blue px-4 py-3 text-center font-semibold text-white">
        Schedule and standings →
      </Link>
    </>
  );
}
