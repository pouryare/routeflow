import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { faNum } from "@/lib/format";
import Reveal from "@/components/kargah/Reveal";
import OrderPipeline, { type PipelineOrder } from "@/components/sales/OrderPipeline";
import OrderJourney from "@/components/sales/OrderJourney";

export const dynamic = "force-dynamic";

/** A query parameter may arrive repeated («?order=1&order=2»), in which case Next hands
 *  over an array. Taking the first beats letting `Number([..])` quietly produce NaN. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 60 });

  // One query for the whole board rather than one per card.
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

  const board: PipelineOrder[] = orders.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    customer_name: o.customer_name,
    salesperson_name: o.salesperson_name,
    status: o.status,
    order_date: o.order_date,
    total_toman: o.total_toman,
    paid_toman: o.paid_toman,
    payment_status: o.payment_status,
    kg: o.kg,
    line_count: o.line_count,
    on_run: onARun.has(o.id),
  }));

  const asked = one((await searchParams).order);
  const wanted = asked !== undefined && /^\d+$/.test(asked) ? Number(asked) : undefined;
  /* Chosen from the list this session can already see, so the journey cannot be used to
     probe for an order in another group by its id -- the scope decision stays in
     orderFilter and is not re-derived here. */
  const focus = orders.find((o) => o.id === wanted) ?? orders[0];
  const journey = focus ? readJourney(db, focus.id) : null;

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <section>
        <h2 className="m-0 text-[length:var(--text-md)] font-medium text-[var(--text)]">
          تابلوی سفارش‌ها
        </h2>
        <p className="m-0 mb-[var(--space-4)] mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {orders.length === 0
            ? "هنوز سفارشی ثبت نشده است."
            : "یک پیش‌نویس را روی «تأییدشده» بکشید تا قیمت‌ها قفل شود، یا روی کارت بزنید تا جزئیاتش باز شود."}
        </p>
        <OrderPipeline orders={board} />
      </section>

      {focus && journey && (
        <section>
          <div className="mb-[var(--space-4)] flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
            <div>
              <h2 className="m-0 text-[length:var(--text-md)] font-medium text-[var(--text)]">
                مسیر سفارش {focus.customer_name}
              </h2>
              <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
                سفارش{" "}
                <span className="num">{faNum(Number(focus.order_no.split("-")[1] ?? 0))}#</span> ·
                هر مرحله از روی همان چیزی خوانده می‌شود که ثبت شده، نه از روی یک تیک دستی.
              </p>
            </div>
            <Link
              href={`/sales/orders/${focus.id}`}
              className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              صفحهٔ سفارش
            </Link>
          </div>

          <Reveal replayKey={focus.id} select=".jlane">
            <OrderJourney nodes={buildJourney(journey)} />
          </Reveal>
        </section>
      )}
    </div>
  );
}
