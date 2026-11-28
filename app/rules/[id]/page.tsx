import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { readRules } from "@/lib/rules-doc";
import RulesSearch from "./RulesSearch";

const read = async (id: string) => {
  await connection();
  return readRules(db, id);
};

export async function generateMetadata({ params }: PageProps<"/rules/[id]">): Promise<Metadata> {
  const { id } = await params;
  const r = await read(id);
  return r ? { title: `${r.name} rules` } : {};
}

// A League's rules (SPEC.md section 13), no login: its Google Doc's text as a page, with a search that shows only the
// sections that match (words highlighted), and Print.
export default function RulesPage({ params }: PageProps<"/rules/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Rules params={params} />
      </Suspense>
    </main>
  );
}

async function Rules({ params }: { params: PageProps<"/rules/[id]">["params"] }) {
  const { id } = await params;
  const r = await read(id);
  if (!r) notFound();
  const o = await orgInfo(db, r.org);
  const updated = r.updatedAt
    ? new Date(r.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })
    : null;
  return (
    <>
      <div className="mb-4 print:hidden">
        <Link href={o ? `/login/${o.slug}` : "/"} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← {o?.name ?? "Back"}
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{r.name} rules</h1>
      {updated && <p className="mt-1 text-sm text-zinc-500">Updated {updated}</p>}
      <RulesSearch sections={r.sections} />
    </>
  );
}
