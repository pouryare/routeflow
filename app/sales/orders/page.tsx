import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import Reveal from "@/components/kargah/Reveal";
import PocketCard, { type PocketDoc, type PocketStatus } from "@/components/kargah/PocketCard";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { pill: PocketStatus; label: string }> = {
  draft: { pill: "draft", label: "پیش‌نویس" },
  confirmed: { pill: "conf", label: "تأییدشده" },
  delivered: { pill: "done", label: "تحویل‌شده" },
  cancelled: { pill: "draft", label: "لغوشده" },
};

/* The artifact's own document tones, kept as literal pairs: strong, then its pale echo. */
const TONE = {
  sage: ["#4F6B4A", "#C7D6C3"] as [string, string],
  accent: ["#C0532B", "#EFC9B8"] as [string, string],
  amber: ["#9A6B10", "#EBD9B2"] as [string, string],
  sky: ["#2E6382", "#BCD5E2"] as [string, string],
  plum: ["#6B4FA0", "#D6CBE9"] as [string, string],
};

/** Four bar heights derived from the order itself.
 *
 *  Deterministic on purpose: a card whose little chart redraws differently on every
 *  render is decoration pretending to be data. These come from the id and the figure, so
 *  the same order always draws the same bars.
 */
function barsFor(seed: number, total: number): [number, number, number, number] {
  const out: number[] = [];
  let x = (seed * 2654435761 + total) >>> 0;
  for (let i = 0; i < 4; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(0.35 + ((x >>> 16) % 66) / 100);
  }
  return out as [number, number, number, number];
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const raw = one((await searchParams).customer);
  const customerId = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;

  const scope = groupFilter(session);
  const focused =
    customerId === undefined
      ? null
      : (db
          .prepare(`SELECT id, business_name FROM customers WHERE id = ?${scope.sql}`)
          .get(customerId, ...scope.params) as { id: number; business_name: string } | undefined) ??
        null;

  const orders = readOrders(db, orderFilter(session), { limit: 100, customerId: focused?.id });

  // Which of these are already loaded onto a van. One query for the page rather than one
  // per row.
  const onARun = new Set(
    (
      plain(
        db
          .prepare(
            `SELECT DISTINCT order_id FROM delivery_stops WHERE order_id IN (${
              orders.map(() => "?").join(",") || "NULL"
            })`
          )
          .all(...orders.map((o) => o.id))
      ) as unknown as { order_id: number }[]
    ).map((r) => r.order_id)
  );

  const customerCount = new Set(orders.map((o) => o.customer_name)).size;

  return (
    <div className="block">
      <div className="bhead">
        <div>
          <h2>{focused ? `سفارش‌های ${focused.business_name}` : "سفارش‌های اخیر"}</h2>
          <div className="n">
            {orders.length === 0
              ? "سفارشی پیدا نشد"
              : `${faNum(orders.length)} سفارش، از ${faNum(customerCount)} مشتری · روی هر کارت بزنید`}
          </div>
        </div>
        <div className="acts">
          {orders.length > 0 && (
            /* A plain anchor with `download`, on purpose: this is a file, not a
               navigation, and next/link would attempt a client-side transition to a
               route that answers with an .xlsx. */
            <a className="btn ghost" href="/api/sales/orders/export" download>
              خروجی اکسل
            </a>
          )}
          <Link
            className="btn solid"
            href={focused ? `/sales/orders/new?customer=${focused.id}` : "/sales/orders/new"}
          >
            ＋ ثبت سفارش تازه
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <p style={{ padding: "0 24px 28px", color: "var(--muted)", fontSize: 13.5 }}>
          {focused
            ? `برای ${focused.business_name} هنوز سفارشی ثبت نشده است.`
            : "اولین سفارش را ثبت کنید. از همان لحظه، بدهی و تاریخ آخرین خرید مشتری‌ها روی نقشه هم به‌روز می‌شود."}
        </p>
      ) : (
        <Reveal replayKey={String(focused?.id ?? "all")} select=".pocket" className="pockets">
          {orders.map((order) => {
            const st = STATUS[order.status] ?? STATUS.draft;
            const docs: PocketDoc[] = [];
            // A draft has not been invoiced, so there is no receipt to file.
            if (order.status !== "draft") {
              docs.push({
                label: "رسید تحویل",
                value: faNum(order.total_toman),
                tone: order.status === "delivered" ? TONE.sage : TONE.amber,
                bars: barsFor(order.id, order.total_toman),
              });
            }
            if (onARun.has(order.id)) {
              docs.push({
                label: "برگهٔ مسیر",
                value: `${faNum(order.kg)} کیلو`,
                tone: TONE.sky,
                bars: barsFor(order.id + 7, Math.round(order.kg)),
              });
            } else if (order.status === "draft") {
              docs.push({
                label: "پیش‌فاکتور",
                value: faNum(order.total_toman),
                tone: TONE.accent,
                bars: barsFor(order.id + 3, order.total_toman),
              });
            }
            return (
              <PocketCard
                key={order.id}
                href={`/sales/orders/${order.id}`}
                customer={order.customer_name}
                meta={`${faNum(Number(order.order_no.split("-")[1]))}# · ${faJalaliDate(order.order_date)}${
                  order.salesperson_name ? ` · ${order.salesperson_name}` : ""
                }`}
                amount={faNum(order.total_toman)}
                status={st.pill}
                statusLabel={st.label}
                docs={docs}
              />
            );
          })}
        </Reveal>
      )}
    </div>
  );
}
