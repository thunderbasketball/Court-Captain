import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Sends through Gmail when GMAIL_USER and GMAIL_APP_PASSWORD are set (a Google app password, not the account password),
// else through Resend when RESEND_API_KEY and EMAIL_FROM are set.
// Otherwise (local testing) prints the email in the terminal running `npm run dev`.
let gmail: Transporter | null = null;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  return sendMail({ to, subject, text });
}

export type Mail = {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: string; contentType: string }[]; // text files (a CSV)
};

// An email with optional copies (Cc) and attached text files (the uniform order's spreadsheet).
export async function sendMail({ to, cc = [], subject, text, attachments = [] }: Mail): Promise<void> {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (gmailUser && gmailPass) {
    gmail ??= nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass.replace(/\s/g, "") } });
    await gmail.sendMail({
      from: process.env.EMAIL_FROM || `Thunder Basketball <${gmailUser}>`,
      to,
      ...(cc.length ? { cc } : {}),
      subject,
      text,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return;
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Email isn't set up (GMAIL_USER / GMAIL_APP_PASSWORD or RESEND_API_KEY / EMAIL_FROM).");
    console.log(
      `\n📧 EMAIL (not sent — email not set up)\n   To: ${to}${cc.length ? `\n   Cc: ${cc.join(", ")}` : ""}\n   ${subject}` +
        (attachments.length ? `\n   Attached: ${attachments.map((a) => a.filename).join(", ")}` : "") +
        "\n",
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      ...(cc.length ? { cc } : {}),
      subject,
      text,
      ...(attachments.length
        ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
