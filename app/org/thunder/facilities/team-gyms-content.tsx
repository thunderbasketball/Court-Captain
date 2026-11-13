import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { teamGyms } from "@/lib/practice/team-gyms";
import TeamGyms from "./TeamGyms";

// The Team Practice Facilities card's inside (Facilities, for Directors of Facilities or Practices).
export async function TeamGymsContent() {
  const user = await currentUser();
  if (!user) return null;
  const data = await teamGyms({ pool: db }, user);
  if (!data) return null;
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who set it
  return (
    <TeamGyms
      gyms={data.gyms}
      who={who}
      teams={data.teams.map((t) => ({ id: t.id, name: t.name, level: t.level, gender: t.gender, grades: t.grades, gyms: t.gyms, everyGym: t.everyGym, setBy: t.setBy }))}
    />
  );
}
