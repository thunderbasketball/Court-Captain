"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { featureRefusal } from "@/lib/features-server";
import * as vendor from "@/lib/uniform-vendor";

// The Uniforms card's vendor gear and Email the vendor. Role checked again in lib/uniform-vendor.
const deps = { pool: db, now: () => new Date(), sendMail };
type Result = ({ ok: true } & object) | { ok: false; message: string };

async function guarded<T extends Result>(
  fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>,
): Promise<T | { ok: false; message: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Please log in again." };
  if (user.actingBy) return { ok: false, message: VIEW_ONLY };
  const refused = await featureRefusal("thunder", "uniforms");
  if (refused) return refused;
  try {
    return await fn(user);
  } catch (e) {
    console.error("Uniform vendor step failed:", e);
    return { ok: false, message: "Something went wrong (the email may not have sent). Please try again." };
  }
}

export async function saveUniformVendor(email: string, cc: string) {
  return guarded((u) => vendor.saveVendor(deps, u, email, cc));
}

export async function emailUniformVendor(everyone: boolean) {
  return guarded((u) => vendor.sendToVendor(deps, u, everyone));
}

export async function previewUniformOrder(everyone: boolean) {
  return guarded((u) => vendor.previewVendorOrder(deps, u, everyone));
}

export async function cancelUniformOrder(orderNo: string, notify: boolean) {
  return guarded((u) => vendor.cancelOrder(deps, u, orderNo, notify));
}
