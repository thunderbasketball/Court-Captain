import SubCard from "./SubCard";

type Step = { who: string; what: string };

// How practice scheduling works, step by step (an expandable card). gyms: the organization books its own gym courts
// (Thunder's practice gyms); own: teams can add practices at a place they found themselves (CourtFacility).
const SETUP: Step = {
  who: "Director sets up the gyms",
  what: "Under Facilities: each gym and its courts, the practice times (1-hour slots on chosen days), and blackout dates (holidays, gym closed). Blocking a date cancels any practices booked then (with a warning first).",
};
const BOOK: Step = {
  who: "Coach books",
  what: "On the team's Practices card, tap Book practices → a gym → an open court time → Book. Tick Every week at this time to take the same court each later week it's open; you'll see which weeks booked and which didn't.",
};
const LIMIT: Step = {
  who: "The weekly limit (Mon–Fri)",
  what: "A team's first practice of the week can be any open time. A second only if it starts within the next 72 hours. Never more than 2 still to come in a week. Example: holding Thursday, you can add Monday once it's within 72 hours; once Monday's done, Tuesday the same way.",
};
const CANCEL: Step = {
  who: "Cancel",
  what: "Coaches, the Team Manager and Directors tap Cancel on a practice: this one, or this and later weeks. The court opens for other teams at once. A practice that has started can't be cancelled.",
};
const OWN: Step = {
  who: "📍 Own gym",
  what: "A place the team found itself (school, church, rec center): place, date, start time and length, or weekly until a date. No limits: any day, any time. Remove this one or this and later weeks.",
};
const SEE: Step = {
  who: "Who sees what",
  what: "Coaches see open times and which team has each court (not who booked it). Directors also see who booked. Team Parents see the schedule but can't book or cancel.",
};

export default function HowPracticesWork({ gyms, own }: { gyms: boolean; own: boolean }) {
  const steps = [...(gyms ? [SETUP, BOOK, LIMIT, CANCEL] : []), ...(own ? [OWN] : []), SEE];
  return (
    <SubCard title="How practice scheduling works">
      <ol className="space-y-3 px-4 py-3 text-sm">
        {steps.map((s, i) => (
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
