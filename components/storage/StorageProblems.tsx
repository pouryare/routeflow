"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { faJalaliDateTime } from "@/lib/jalali";
import type { ProblemRow } from "@/lib/repo/storages";

const PROBLEM_LABEL: Record<ProblemRow["problem"], string> = {
  no_storage: "فضایی تعریف نکرده؛ آپلود بسته است",
  check_failed: "بررسی فضا ناموفق",
  near_full: "نزدیک به پر شدن",
  held: "فایل بیش از یک ساعت روی سرور مانده",
  file_missing: "فایل در بررسی هفتگی پیدا نشد",
};

/** The platform owner's list of every company's storage problems (decision 19). */
export default function StorageProblems() {
  const [rows, setRows] = useState<ProblemRow[] | null>(null);
  useRunAfterMount(async () => {
    const res = await fetch("/api/storages/problems");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setRows(json.problems as ProblemRow[]); // another role gets a 403: no card at all
  });
  if (rows === null) return null;
  return (
    <section className="card flex flex-col gap-2 p-[var(--space-4)]">
      <h2 className="sechead__title flex items-center gap-2">
        <Icon name="building" size="md" />
        مشکلات فضای همهٔ شرکت‌ها
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">همهٔ شرکت‌ها فضای سالم دارند.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r, i) => (
            <li key={`${r.organization_id}-${r.storage_id}-${r.problem}-${i}`} className="flex flex-col border-b border-border py-2 text-sm last:border-b-0">
              <span>
                {r.company}
                {r.storage_name ? ` · ${r.storage_name}` : ""}
              </span>
              <span className={r.problem === "near_full" ? "text-xs text-text-muted" : "text-xs text-crit"}>
                {PROBLEM_LABEL[r.problem]}
                {r.detail && r.problem !== "near_full" ? ` · ${r.detail}` : ""}
                {r.since ? ` · ${faJalaliDateTime(r.since)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
