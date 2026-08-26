import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Placeholder until Phase 1a builds the real driver app (spec §3.3).
 *
 *  It exists because proxy.ts sends every driver here and three pages redirect here, so
 *  without it the first driver account anyone creates lands on a 404 with nowhere to go --
 *  and a driver cannot reach any other page to find that out. A page that says "not ready
 *  yet" is a far better answer than a dead end. */
export default async function DriverPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <div className="font-mono text-xs tracking-[0.12em] text-accent uppercase">Coverage Map</div>
      <h1 className="text-xl font-bold text-text">
        {session.user.display_name} عزیز، خوش آمدید
      </h1>
      <p className="max-w-sm text-sm text-text-muted">
        برنامه راننده هنوز آماده نشده است. به‌زودی مسیر امروز و لیست تحویل‌ها همین‌جا نمایش
        داده می‌شود.
      </p>
      {/* Owners and managers can be sent somewhere useful; a driver has nowhere else to be,
          so offering them a link would only produce a redirect straight back here. */}
      {session.role !== "driver" && (
        <Link href="/" className="text-sm text-accent transition-opacity hover:opacity-80">
          بازگشت به نقشه
        </Link>
      )}
      <form action="/api/logout" method="post">
        <button type="submit" className="cursor-pointer text-xs text-text-faint transition-colors hover:text-accent">
          خروج از حساب
        </button>
      </form>
    </main>
  );
}
