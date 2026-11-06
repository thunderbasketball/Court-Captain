import type { Metadata } from "next";
import { orgMetadata } from "@/lib/org-metadata";

// Its logo as the tab icon and its name in the tab title.
export function generateMetadata(): Promise<Metadata> {
  return orgMetadata("thunder");
}

export default function Layout({ children }: LayoutProps<"/org/thunder">) {
  return children;
}
