import { Suspense } from "react";
import { UniformsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/uniforms">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <UniformsContent  />
    </Suspense>
  );
}
