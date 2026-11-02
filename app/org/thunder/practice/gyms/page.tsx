import { redirect } from "next/navigation";

// Moved to the Facilities tab.
export default function Moved() {
  redirect("/org/thunder/facilities/gyms");
}
