import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { publicly } from "@/lib/public-cache";
import { scoreCard, shareText } from "@/lib/score-share";

// Read when someone asks (never while the site is built: whether it's ready depends on the time).
const read = async (id: string) => {
  await connection();
  return publicly(`score:${id.slice(0, 20)}`, () => scoreCard(db, new Date(), id));
};

// A shared link's preview: the final and its picture.
export async function generateMetadata({ params }: PageProps<"/score/[id]">): Promise<Metadata> {
  const { id } = await params;
  const card = await read(id);
  if (!card) return {};
  const title = shareText(card);
  const image = { url: `/score/${card.id}/image?shape=wide&v=${card.winner.score}-${card.loser.score}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description: card.program,
    metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
    openGraph: { title, description: card.program, url: `/score/${card.id}`, siteName: "CourtCaptain", images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

// One final's public page (no login): where a shared link leads. Its picture, and on to the League's organization.
export default function ScorePage({ params }: PageProps<"/score/[id]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Score params={params} />
      </Suspense>
    </main>
  );
}

async function Score({ params }: { params: PageProps<"/score/[id]">["params"] }) {
  const { id } = await params;
  const card = await read(id);
  const o = card && (await orgInfo(db, card.org));
  if (!card || !o) notFound();
  return (
    <>
      <h1 className="sr-only">{shareText(card)}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on the fly */}
      <img
        src={`/score/${card.id}/image?v=${card.winner.score}-${card.loser.score}`}
        alt={shareText(card)}
        width={1080}
        height={1080}
        className="w-full rounded-2xl shadow-lg"
      />
      <Link href={`/login/${o.slug}`} className="mt-4 block rounded-xl bg-thunder-blue px-4 py-3 text-center font-semibold text-white">
        More from {o.name} →
      </Link>
    </>
  );
}
