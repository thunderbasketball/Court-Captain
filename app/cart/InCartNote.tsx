import type { InCart } from "@/lib/cart";

// On a team's registration: whose cart it's in (not paid for yet), and for what.
export default function InCartNote({ list }: { list: InCart[] }) {
  return (
    <>
      {list.map((c, i) => (
        <p key={i} className="text-sm font-medium text-amber-700 dark:text-amber-400">
          {c.invoiceId ? `On invoice #${c.invoiceId}, requested by ${c.mine ? "you" : c.name}` : `In ${c.mine ? "your" : `${c.name}\u2019s`} cart`}
          {c.what && `: ${c.what}`} <span className="font-normal">(not paid yet)</span>
        </p>
      ))}
    </>
  );
}
