import "server-only";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { invoiceEmail } from "@/lib/invoices";

// Emails an organization's invoice for a program to its Owners (PAID, or PAY LATER with the link to pay). Run after the
// response (next/server `after`), so registering isn't slowed; a failed email is logged, never shown. The link is always
// the site's own address (APP_URL: court-captain.com on the live site), never the address of whoever registered (a
// computer's localhost, a phone on the home network).
export async function sendInvoice(programId: string, org: string, _base?: string) {
  void _base;
  try {
    const m = await invoiceEmail(db, programId, org, process.env.APP_URL || "http://localhost:3000");
    if (!m || !m.to.length) return;
    for (const to of m.to) await sendEmail(to, m.subject, m.text);
  } catch (e) {
    console.error("Invoice email failed:", e);
  }
}
