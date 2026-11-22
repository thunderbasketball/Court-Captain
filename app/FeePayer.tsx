"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CARD_CENTS, CARD_PERCENT, cardFee } from "@/lib/stripe/card-fee";
import { Toast } from "./client-ui";
import { setStripeFeePayer } from "./stripe/actions";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const EXAMPLE = 25000;

// Payments → Card fee: who pays Stripe's 2.9% + 30¢ on each registration, with what a $250 fee comes to either way.
export default function FeePayer({ org, payer: initial, by }: { org: string; payer: "org" | "team"; by: string | null }) {
  const router = useRouter();
  const [payer, setPayer] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const kept = Math.round(EXAMPLE * (1 - CARD_PERCENT / 100) - CARD_CENTS);
  const added = cardFee(EXAMPLE);
  const choices = [
    {
      key: "org" as const,
      label: "Organization pays",
      about: `Teams pay the price. You receive about ${money(kept)} of a ${money(EXAMPLE)} fee.`,
    },
    {
      key: "team" as const,
      label: "Added for the team",
      about: `Teams pay ${money(EXAMPLE + added)} for a ${money(EXAMPLE)} fee (Card processing ${money(added)}). You receive the full ${money(EXAMPLE)}.`,
    },
  ];
  const pick = (key: "org" | "team") =>
    start(async () => {
      const before = payer;
      setPayer(key);
      const r = await setStripeFeePayer(org, key);
      if (!r.ok) {
        setPayer(before);
        return setMsg(r.message);
      }
      setMsg("Saved.");
      router.refresh();
    });
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 font-medium">
        Card fee ({CARD_PERCENT}% + {CARD_CENTS}¢ per payment)
      </legend>
      {choices.map((c) => (
        <label key={c.key} className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name={`fee-payer-${org}`}
            className="mt-1 size-4"
            checked={payer === c.key}
            disabled={busy}
            onChange={() => pick(c.key)}
          />
          <span>
            <span className="font-medium">{c.label}</span>
            <span className="block text-xs text-zinc-500">{c.about}</span>
          </span>
        </label>
      ))}
      {by && <p className="text-xs text-zinc-400">Set by {by}</p>}
      {msg && <Toast key={msg} message={msg} />}
    </fieldset>
  );
}
