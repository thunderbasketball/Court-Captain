import type { PaymentStatus } from "@/lib/stripe/connect";
import { TZ } from "@/lib/time";
import FeePayer from "./FeePayer";

// Organization settings → Payments (Owners): its own Stripe account, so teams pay its registration fees by card straight
// to it. Connect Stripe (and Finish Stripe setup) go to Stripe's own sign-up (app/stripe/connect); Stripe brings them back.
export const paymentsLabel = (s: PaymentStatus) =>
  s.state === "ready" ? "Connected" : s.state === "pending" ? "Finish setup" : s.state === "not-connected" ? "Not connected" : "Coming soon";

export default function PaymentsCard({ org, status }: { org: string; status: PaymentStatus }) {
  if (status.state === "not-set-up")
    return <p className="text-sm text-zinc-500">Online payments aren&apos;t set up on CourtCaptain yet.</p>;
  const button = (label: string) => (
    <form method="post" action="/stripe/connect">
      <input type="hidden" name="org" value={org} />
      <button type="submit" className="rounded-full bg-[#635bff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5146e5]">
        {label}
      </button>
    </form>
  );
  if (status.state === "not-connected")
    return (
      <div className="space-y-3 text-sm">
        <p className="text-zinc-600 dark:text-zinc-300">
          Connect your organization&apos;s own Stripe account so teams can pay registration fees by card. The money goes straight
          to your account; you choose whether Stripe&apos;s card fee comes out of each payment or is added for the team. Already have a Stripe account? You can sign in to it on the
          next screen.
        </p>
        {button("Connect Stripe")}
      </div>
    );
  const when = status.connectedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  return (
    <div className="space-y-3 text-sm">
      {status.state === "ready" ? (
        <p className="font-medium text-emerald-700 dark:text-emerald-400">✓ Connected: teams can pay by card.</p>
      ) : (
        <p className="font-medium text-amber-700 dark:text-amber-300">Stripe needs a few more details before you can take payments.</p>
      )}
      <p className="text-zinc-500">
        Stripe account …{status.account.slice(-6)} · connected by {status.connectedBy} on {when}
        {status.live ? "" : " · test mode (no real money)"}
      </p>
      <FeePayer org={org} payer={status.feePayer} by={status.feePayerBy} />
      <div className="flex flex-wrap items-center gap-3">
        {status.state === "pending" && button("Finish Stripe setup")}
        <a
          href={status.live ? "https://dashboard.stripe.com/" : "https://dashboard.stripe.com/test/dashboard"}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-thunder-blue dark:text-blue-400"
        >
          Open Stripe ↗
        </a>
      </div>
    </div>
  );
}
