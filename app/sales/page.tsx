import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { faJalaliLong } from "@/lib/jalali";
import StatCard, { StatRow } from "@/components/charts/StatCard";

export const dynamic = "force-dynamic";

/** The sales summary.
 *
 *  Deliberately honest while the section is being built: the cards below read zero
 *  because nothing has been recorded yet, not because something is broken. Showing them
 *  now rather than hiding the page until slice two means the shape of the thing is
 *  visible, and an empty figure with a date on it is a truthful empty figure.
 */
export default async function SalesHomePage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const today = faJalaliLong(new Date().toISOString());

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">امروز، {today}</p>

      <StatRow>
        <StatCard label="فروش امروز" value="۰ تومان" hint="هنوز سفارشی ثبت نشده" />
        <StatCard label="سفارش‌های امروز" value="۰" hint="ثبت سفارش به‌زودی" />
        <StatCard label="در انتظار تحویل" value="۰" />
        <StatCard label="مانده حساب مشتریان" value="۰ تومان" />
      </StatRow>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
          این بخش در حال ساخت است
        </h2>
        <p className="mt-[var(--space-2)] text-[length:var(--text-sm)] leading-7 text-[var(--text-muted)]">
          سفارش‌ها تا امروز روی کاغذ ثبت می‌شدند. این بخش جای همان کاغذ را می‌گیرد — نه
          جای اکسل، چون سفارشی در اکسل ثبت نشده بود. مراحل بعدی به ترتیب:
        </p>
        <ol className="mt-[var(--space-3)] flex list-decimal flex-col gap-[var(--space-2)] ps-[var(--space-5)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
          <li>کالاها، بسته‌بندی‌ها و قیمت‌های تاریخ‌دار</li>
          <li>ثبت سفارش از موبایل — با ثبت قیمت و وزن همان لحظه</li>
          <li>تحویل، دریافت وجه و چاپ رسید با پرینتر بلوتوث</li>
          <li>پورسانت بر اساس کیلوگرم تحویل‌شده</li>
          <li>خرید و موجودی انبار</li>
        </ol>
      </section>
    </div>
  );
}
