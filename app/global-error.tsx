"use client";

import "./globals.css";
import { Icon } from "@/components/meridian/Icon";
import StatePage from "@/components/meridian/StatePage";

/** The root layout itself failed. This replaces the whole document, so it must bring its
 *  own <html> and <body> and its own stylesheet (the root layout, which normally imports
 *  globals.css and sets lang/dir, is exactly what did not render). The theme scripts do
 *  not run here, so it paints in the default skin: better a consistent page than a
 *  flash of the framework's English default. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <title>خطا</title>
        <div className="meridian">
          <StatePage
            icon="warn"
            eyebrow="خطای برنامه"
            title="برنامه نتوانست بالا بیاید"
            hint="یک بار دیگر امتحان کنید. اگر مشکل ادامه داشت، کد پیگیری پایین را برای پشتیبانی بفرستید."
            code={error.digest}
            actions={
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => retry()}>
                <Icon name="undo" size="md" />
                تلاش دوباره
              </button>
            }
          />
        </div>
      </body>
    </html>
  );
}
