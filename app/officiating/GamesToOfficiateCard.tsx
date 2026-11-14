import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { officialsBoard } from "@/lib/officiating-schedule";
import { GamesToOfficiate } from "./GamesToOfficiate";

// The Games to officiate card's inside: the board, built only while the card is open.
export default async function GamesToOfficiateCard({ org, user }: { org: string; user: SessionUser }) {
  const board = await officialsBoard({ pool: db, now: () => new Date() }, user, org);
  return board ? <GamesToOfficiate org={org} board={board} /> : null;
}
