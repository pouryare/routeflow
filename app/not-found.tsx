import Link from "next/link";
import StatePage from "@/components/meridian/StatePage";

/** Every unmatched address, and every `notFound()`, in the app's own look.
 *
 *  Renders inside the root layout but outside the shell, which is where the `.meridian`
 *  scope (and so every design token) is applied, hence the wrapper here. */
export default function NotFound() {
  return (
    <div className="meridian">
      <StatePage
        icon="compass"
        eyebrow="صفحه پیدا نشد"
        title="این نشانی به جایی نمی‌رسد"
        hint="ممکن است صفحه جابه‌جا شده باشد یا نشانی اشتباه تایپ شده باشد. از فهرست بالای برنامه یا جستجو (Ctrl K) صفحهٔ مورد نظر را پیدا کنید."
        actions={
          <>
            <Link className="btn solid" href="/sales">
              رفتن به داشبورد
            </Link>
            <Link className="btn ghost" href="/map">
              نقشه
            </Link>
          </>
        }
      />
    </div>
  );
}
