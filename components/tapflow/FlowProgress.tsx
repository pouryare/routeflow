"use client";

import { ProgressBar } from "@heroui/react";

/** How far through its longest path a flow is. `total` is `budget.longest`, which
 *  crm-flow-configs.test.ts asserts bounds the real path, so the bar never overruns. */
export default function FlowProgress({ done, total }: { done: number; total: number }) {
  return (
    <ProgressBar aria-label="پیشرفت فرم" value={Math.min(done, total)} minValue={0} maxValue={total} size="sm" className="tf-steps">
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
