"use client";

import Link from "next/link";
import StatePage from "@/components/meridian/StatePage";

/** A page inside the shell threw. The header stays (this boundary sits below the shell
 *  layout), so the reader keeps their navigation; only the page body is replaced.
 *
 *  `retry` re-fetches and re-renders the page, which is what fixes a transient failure
 *  (Next 16's recommendation over `reset`, which only re-renders). The digest is shown
 *  so the reader can quote it; the message is not, because in production a server
 *  error's message is deliberately generic. */
export default function ShellError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <StatePage
      icon="warn"
      eyebrow="خطا در بارگذاری"
      title="این صفحه درست بار نشد"
      hint="معمولاً یک تلاش دوباره کافی است. اگر باز هم تکرار شد، کد پیگیری پایین را برای پشتیبانی بفرستید."
      code={error.digest}
      actions={
        <>
          <button type="button" className="btn solid" onClick={() => retry()}>
            تلاش دوباره
          </button>
          <Link className="btn ghost" href="/sales">
            رفتن به داشبورد
          </Link>
        </>
      }
    />
  );
}
