"use client";

import { useState } from "react";
import type { SupportArticle } from "@/lib/support";
import SubCard from "../../SubCard";
import { ArticleList } from "../../support/SupportPanel";
import { inputCls } from "../../ui";

// The public page's Help (no login): the questions and guides for parents and visitors, only this organization's features.
export default function PublicHelp({ articles }: { articles: SupportArticle[] }) {
  const [find, setFind] = useState("");
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = articles.filter((a) => words.every((w) => `${a.title} ${a.body} ${a.topic}`.toLowerCase().includes(w)));
  return (
    <section id="help" className="scroll-mt-4 space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Help</h2>
      <SubCard title="Questions & how to" count={articles.length}>
        <div className="space-y-3">
          <input className={inputCls} placeholder="Search…" value={find} onChange={(e) => setFind(e.target.value)} />
          <ArticleList articles={shown} empty="Nothing matches." />
        </div>
      </SubCard>
    </section>
  );
}
