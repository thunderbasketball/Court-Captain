// Testing mode only: logs you in as a Director with no PIN or code.
// Uses the first Director in the database, or creates "Test Director" if there isn't one.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deps, devBypass, setSessionCookie } from "@/lib/auth/server";
import { startSession } from "@/lib/auth/service";

export async function GET() {
  if (!devBypass) return new NextResponse("Not found", { status: 404 });

  let r = await db.query<{ coach_id: string }>(
    "select coach_id from users where has_role(coach_id, 'thunder', 'Director') and active order by created_at limit 1",
  );
  if (!r.rows.length) {
    r = await db.query<{ coach_id: string }>(
      `insert into users (coach_id, first_name, last_name, cell)
       values ('0000001', 'Test', 'Director', '9990000001')
       on conflict (coach_id) do update set active = true
       returning coach_id`,
    );
    await db.query(
      "select set_role($1, 'thunder', 'Director', true, 'testing mode'), set_role($1, 'thunder', 'Coach', true, 'testing mode')",
      [r.rows[0].coach_id],
    );
  }
  const s = await startSession(deps, db, r.rows[0].coach_id);
  if (s.step === "loggedIn") await setSessionCookie(s.token, s.expiresAt);
  return new NextResponse(null, { status: 307, headers: { Location: "/" } }); // by path: stays on the address in use
}
