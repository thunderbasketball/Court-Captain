"use client";

// Print (hidden on paper). Opens the browser's print dialog: pick the printer, or Save as PDF.
export default function PrintButton({ count }: { count: number }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-thunder-blue px-5 py-2 text-sm font-semibold text-white hover:bg-thunder-blue-dark print:hidden"
    >
      Print {count} scoresheet{count === 1 ? "" : "s"}
    </button>
  );
}
