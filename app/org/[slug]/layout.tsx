import type { Metadata } from "next";
import { orgMetadata } from "@/lib/org-metadata";

// The organization's logo as the tab icon and its name in the tab title.
export async function generateMetadata({ params }: LayoutProps<"/org/[slug]">): Promise<Metadata> {
  return orgMetadata((await params).slug);
}

export default function Layout({ children }: LayoutProps<"/org/[slug]">) {
  return children;
}
