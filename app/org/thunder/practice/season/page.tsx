import { redirect } from "next/navigation";

// Practice Court Availability lives in Home → Practice now; old links open that card.
export default function Page() {
  redirect("/org/thunder?open=schedule#schedule");
}
