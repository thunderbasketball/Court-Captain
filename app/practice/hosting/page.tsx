import { redirect } from "next/navigation";

// Hosting moved to the Facilities tab.
export default function HostingMoved() {
  redirect("/facilities");
}
