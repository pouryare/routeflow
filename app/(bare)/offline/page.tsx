import Link from "next/link";
import StatePage from "@/components/meridian/StatePage";

/** What the service worker serves when a page is not cached and there is no connection.
 *  On the shared StatePage like the 404 and the error pages; the eyebrow used to be the
 *  English word «Offline». The bare layout provides the `.meridian` scope. */
export default function OfflinePage() {
  return (
    <StatePage
      icon="satellite"
      eyebrow="بدون اتصال"
      title="این صفحه بدون اینترنت در دسترس نیست"
      hint="نقشه و اطلاعاتی که قبلاً باز کرده‌اید ممکن است همچنان دیده شوند. وقتی اتصال برقرار شد دوباره تلاش کنید."
      actions={
        <Link className="btn solid" href="/map">
          بازگشت به نقشه
        </Link>
      }
    />
  );
}
