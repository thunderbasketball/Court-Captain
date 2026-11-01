import Link from "next/link";
import { db } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { isOrgAdmin } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import OrgLogo from "./OrgLogo";
import OrgSettings from "./OrgSettings";
import { Chip } from "./ui";

// The gear by an organization's name, for its Admins only (checked here on the server): its features (link to manage
// them) and its logo.
export default async function OrgGear({ org, coachId }: { org: string; coachId: string }) {
  const [admin, o, on, asked] = await Promise.all([
    isOrgAdmin(db, coachId, org),
    orgInfo(db, org),
    db.query<{ feature: string }>("select feature from org_features where org = $1", [org]),
    db.query<{ feature: string }>("select feature from org_feature_requests where org = $1", [org]),
  ]);
  if (!admin || !o) return null;
  const name = (k: string) => FEATURES.find((f) => f.key === k)?.name ?? k;
  return (
    <OrgSettings
      org={org}
      logo={<OrgLogo src={o.logo} name={o.name} color={o.color} className="size-14 rounded-xl text-xl" />}
      features={
        <>
          <div className="flex flex-wrap gap-2">
            {on.rows.map((f) => (
              <Chip key={f.feature} tone="green">
                {name(f.feature)}
              </Chip>
            ))}
            <Chip tone="green">Alerts</Chip>
            {asked.rows.map((f) => (
              <Chip key={f.feature} tone="zinc">
                {name(f.feature)} · coming soon
              </Chip>
            ))}
          </div>
          <Link href="/upgrades" className="mt-3 inline-block text-sm font-semibold text-thunder-blue hover:underline">
            Manage features →
          </Link>
        </>
      }
    />
  );
}
