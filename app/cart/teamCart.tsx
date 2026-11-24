import type { SessionUser } from "@/lib/auth/service";
import { getCart } from "@/lib/cart";
import { pendingInvoices } from "@/lib/cart-invoices";
import { db } from "@/lib/db";
import { stripeApi } from "@/lib/stripe/client";
import CartList from "./CartList";
import PendingInvoices from "./PendingInvoices";

// A team page's Cart card: what this person has in their cart for the team's organization, and the invoices they asked for
// (null: nothing).
export async function teamCart(user: SessionUser, org: string): Promise<{ count: number; body: React.ReactNode } | null> {
  const deps = { pool: db, stripe: stripeApi(), now: () => new Date() };
  const [cart, pending] = [await getCart(deps, user, org), await pendingInvoices(deps, user, { org })];
  if (!cart.count && !cart.gone.length && !pending.length) return null;
  return {
    count: cart.count,
    body: (
      <div className="space-y-4">
        {pending.length > 0 && <PendingInvoices list={pending} canAct={!user.actingBy} />}
        {(cart.count > 0 || cart.gone.length > 0) && <CartList cart={cart} canPay={!user.actingBy} />}
      </div>
    ),
  };
}
