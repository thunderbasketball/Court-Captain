import type { GuardianLogin as Login } from "@/lib/guardian-logins";
import { ResetLoginButton } from "./ResetLoginButton";
import { Chip } from "./ui";
import { ViewAsButton } from "./ViewAsButton";

// A parent's login, by their name (Members → Players and Families): verified or not, then (Admins) 👁 View as and Reset login.
export default function GuardianLogin({ login, name }: { login: Login | undefined; name: string }) {
  if (!login) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Chip tone={login.verified ? "green" : "amber"}>{login.verified ? "Login ✓ verified" : "Login · not verified"}</Chip>
      {login.viewAs && <ViewAsButton coachId={login.id} name={name} />}
      {login.reset && <ResetLoginButton org="thunder" coachId={login.id} name={name} />}
    </span>
  );
}
