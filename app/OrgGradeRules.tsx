"use client";

import { useState } from "react";
import type { OrgGradeRules as Rules } from "@/lib/grade-rules";
import { PopUp } from "./client-ui";
import { changeOrgGradeRules } from "./register/actions";
import GradeRulesForm, { rulesSummary } from "./GradeRulesForm";

// The organization gear's Grade requirements line: what its rosters are checked against (its own, or its League's when
// adopted), with Edit.
export default function OrgGradeRules({ org, grades, today }: { org: string; grades: Rules; today: string }) {
  const [key, setKey] = useState(0);
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0 text-sm">
        <span className="font-semibold">Grade requirements</span>
        <span className="block text-xs text-zinc-500">
          {grades.from && `Adopted from ${grades.from}: `}
          {grades.adopt && !grades.from && "Adopting (no current League yet): "}
          {rulesSummary(grades.rules, today)}
        </span>
      </span>
      <PopUp
        key={key}
        label="Edit"
        title="Grade requirements"
        className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-thunder-blue ring-1 ring-thunder-blue/30 dark:text-blue-400"
      >
        {(close) => (
          <GradeRulesForm
            rules={grades.own}
            today={today}
            adopt={{ on: grades.adopt, league: grades.league }}
            save={(r, adopt) => changeOrgGradeRules(org, r, adopt)}
            onSaved={() => {
              close();
              setKey((k) => k + 1);
            }}
          />
        )}
      </PopUp>
    </div>
  );
}
