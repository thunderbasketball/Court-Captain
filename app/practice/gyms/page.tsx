import { redirect } from "next/navigation";

// Moved to the Facilities tab.
export default function Moved() {
  redirect("/facilities/gyms");
}
