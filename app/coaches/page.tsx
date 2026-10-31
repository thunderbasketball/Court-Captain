import { redirect } from "next/navigation";

// Moved under Members.
export default function Moved() {
  redirect("/members/coaches");
}
