import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import { findCard } from "@/lib/public-facts";

const read = async (org: string, card: string) => {
  await connection(); // read when someone asks, never while the site is built
  return findCard(org, card, new Date());
};

// A shared link's preview: the picture.
export async function generateMetadata({ params }: PageProps<"/share/[org]/[card]">): Promise<Metadata> {
  const { org, card } = await params;
  const hit = await read(org, card);
  if (!hit) return {};
  const at = `/share/${hit.org.slug}/${hit.card.key}`;
  const image = { url: `${at}/image?shape=wide&v=${hit.v}`, width: 1200, height: 630, alt: hit.card.text };
  return {
    title: `${hit.card.title} · ${hit.org.name}`,
    description: hit.card.text,
    metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
    openGraph: { title: hit.card.title, description: hit.card.text, url: at, siteName: hit.org.name, images: [image] },
    twitter: { card: "summary_large_image", title: hit.card.title, description: hit.card.text, images: [image] },
  };
}

// Where a shared link leads (no login): the picture, then what it's about. One that's over (registration closed) goes to
// the organization's page.
export default function SharePage({ params }: PageProps<"/share/[org]/[card]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Shared params={params} />
      </Suspense>
    </main>
  );
}

async function Shared({ params }: { params: PageProps<"/share/[org]/[card]">["params"] }) {
  const { org, card } = await params;
  const hit = await read(org, card);
  if (!hit) {
    if (isOrgSlug(org) && (await orgInfo(db, org))) redirect(`/login/${org}`);
    notFound();
  }
  const { card: c, org: o } = hit;
  return (
    <>
      <h1 className="sr-only">{c.text}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on the fly */}
      <img src={`/share/${o.slug}/${c.key}/image?v=${hit.v}`} alt={c.text} width={1080} height={1080} className="w-full rounded-2xl shadow-lg" />
      <Link href={c.href} className="mt-4 block rounded-xl bg-thunder-blue px-4 py-3 text-center font-semibold text-white">
        {c.foot} →
      </Link>
      {c.href !== `/login/${o.slug}` && (
        <Link href={`/login/${o.slug}`} className="mt-3 block text-center text-sm font-medium text-thunder-blue hover:underline dark:text-blue-400">
          More from {o.name}
        </Link>
      )}
    </>
  );
}
