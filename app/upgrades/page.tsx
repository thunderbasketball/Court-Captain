import { redirect } from "next/navigation";

// Features are managed in each organization's gear (Organization settings) now; old links go home.
export default function UpgradesPage() {
  redirect("/");
}
