"use client";

import { useSearchParams } from "next/navigation";
import { Toast } from "./client-ui";

// Back from paying a registration fee (app/stripe/paid adds ?paid=…): how it went.
const SAY: Record<string, string> = {
  done: "Paid. Registration complete.",
  pending: "The payment isn't finished, so registration isn't complete yet.",
  cancelled: "Payment cancelled. Not registered yet.",
  failed: "Paid, but registration couldn't go through. The League will refund it or sort it out.",
};

export default function PaidNotice() {
  const paid = useSearchParams().get("paid");
  const message = paid ? SAY[paid] : null;
  return message ? <Toast key={paid} message={message} /> : null;
}
