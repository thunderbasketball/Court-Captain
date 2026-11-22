import SubCard from "../../../SubCard";

// The uniform workflow, step by step: on each team's Uniforms card (coaches) and Home's Uniforms card (Directors).
const STEPS: { who: string; what: string }[] = [
  {
    who: "Parent registers",
    what: "Needs a uniform: gives the size (and the number they'd like). Already has one: gives the number on it. Both show to the coach as “Parent asked”.",
  },
  {
    who: "Coach verifies",
    what: "The coach decides each player's number, and sets the size for those ordering (Use, or fix it). A player who already has a uniform locks 🔒 once their number is saved.",
  },
  {
    who: "Coach: Needs a uniform",
    what: "Any player can be ticked: a family that didn't order one, or a player whose uniform was already ordered but is outgrown or lost (a new one goes in the next order). Coming: this emails the parent a link to give the size, with payment instructions.",
  },
  {
    who: "Director orders",
    what: "Director of Uniforms emails the order to the vendor (order #20261121). Every player on it locks 🔒 and shows Ordered · #number.",
  },
  {
    who: "Fixing a mistake",
    what: "A team's Head or Assistant Coach, an Admin, the Director of Uniforms or an Owner taps Unlock. A changed player goes in the next order. A bad order can be cancelled; its players unlock.",
  },
];

export default function HowUniformsWork() {
  return (
    <SubCard title="How uniforms work">
      <ol className="space-y-3 px-4 py-3 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.who} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-thunder-blue text-xs font-bold text-white">
              {i + 1}
            </span>
            <span>
              <span className="block font-semibold">{s.who}</span>
              <span className="text-zinc-600 dark:text-zinc-400">{s.what}</span>
            </span>
          </li>
        ))}
      </ol>
    </SubCard>
  );
}
