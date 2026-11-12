"use client";

import { inputCls } from "./ui";

export type PinInput = { pin: string; address: string };
export const NO_PIN: PinInput = { pin: "", address: "" };

// Set a location by hand: a pin copied from Google Maps (the numbers, or Share → Copy link) and the address typed.
export default function PinFields({ value, onChange }: { value: PinInput; onChange: (v: PinInput) => void }) {
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">
          Pin from Google Maps: drop a pin, then copy the numbers (like 35.0312, -85.2701) or Share → Copy link
        </span>
        <input
          className={inputCls}
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.target.value })}
          placeholder="35.0312, -85.2701 or https://maps.app.goo.gl/…"
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">Address (as it should show)</span>
        <input
          className={inputCls}
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="123 Main St, Chattanooga, TN 37404"
          maxLength={200}
        />
      </label>
    </div>
  );
}
