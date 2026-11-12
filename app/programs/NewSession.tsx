"use client";

import { useState } from "react";
import NewEventForm from "../events/new/NewEventForm";

// + Session's form, right in the program's card: today's event form for this program, fresh after each one is made.
export default function NewSession(props: {
  programId: string;
  people: { id: string; name: string }[];
  gyms: string[];
  types: string[];
}) {
  const [n, setN] = useState(0);
  const [made, setMade] = useState(false);
  return (
    <div className="space-y-2">
      {made && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Session added ✓</p>}
      <NewEventForm key={n} {...props} onDone={() => (setMade(true), setN(n + 1))} />
    </div>
  );
}
