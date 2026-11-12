"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddIcon, CardPanel, ImportIcon, PanelIcon, iconBtn } from "./CardIcons";
import ImportGymsButton from "./ImportGyms";
import { AddGymForm } from "./org/[slug]/facilities/OrgGyms";
import { AddGymButton } from "./org/thunder/practice/PracticeTools";

const id = (org: string, what: string) => `gym-${what}-${org}`;

// The Gyms card's title line: Import and + Add as icons. Each opens its form right in the card (GymToolPanels).
export function GymToolIcons({ org }: { org: string }) {
  return (
    <span className="flex items-center gap-2">
      <PanelIcon id={id(org, "import")} label="Import gyms" className={iconBtn}>
        <ImportIcon />
      </PanelIcon>
      <AddIcon id={id(org, "add")} label="Add a gym" />
    </span>
  );
}

// The forms those icons open, at the top of the Gyms card (tap the icon again to close).
export function GymToolPanels({ org }: { org: string }) {
  const router = useRouter();
  const [n, setN] = useState(0); // a fresh form after each gym added
  const [added, setAdded] = useState<string | null>(null);
  const box = "mb-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5";
  return (
    <>
      <CardPanel id={id(org, "import")} className={box}>
        <ImportGymsButton org={org} inline />
      </CardPanel>
      <CardPanel id={id(org, "add")} className={box}>
        {org === "thunder" ? (
          <AddGymButton inline />
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold">Add a gym</p>
            {added && <p className="mb-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">{added} added ✓</p>}
            <AddGymForm
              key={n}
              org={org}
              onAdded={(name) => {
                setAdded(name);
                setN(n + 1);
                router.refresh();
              }}
            />
          </>
        )}
      </CardPanel>
    </>
  );
}
