import { Icon } from "@/components/meridian/Icon";
import Link from "next/link";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { CHEQUE_STATUS_LABEL } from "@/lib/chequeStates";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/flows/complaint";
import type { Customer360 } from "@/lib/repo/customer360";
import type { ComplaintCategory, ComplaintSeverity } from "@/lib/repo/complaints";

const TOUCH = { minHeight: 44, minWidth: 44 };

/** F47: open cheques and open complaints beside the balance on the customer page. A card the
 *  role may not see arrives as null and is not drawn; an empty one says so in a line. */
export default function CustomerOpenItems({ data }: { data: Customer360 }) {
  return (
    <>
      {data.cheques && (
        <section className="tile" aria-label="چک‌های باز">
          <h2>چک‌های باز</h2>
          {data.cheques.items.length === 0 ? (
            <p>چک بازی ندارد.</p>
          ) : (
            <>
              <p>
                {data.cheques.items.length.toLocaleString("fa-IR")} چک · {faToman(data.cheques.total_toman)}
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {data.cheques.items.map((c) => (
                  <li key={c.id} style={{ color: c.status === "bounced" ? "var(--crit)" : undefined }}>
                    چک {c.cheque_no} · {faToman(c.amount_toman)} · سررسید {faJalaliDate(c.due_date)} · {CHEQUE_STATUS_LABEL[c.status]}
                  </li>
                ))}
              </ul>
              <Link href="/sales/cheques" className="btn ghost" style={TOUCH}>
                <Icon name="banknote" size="md" />
                صفحهٔ چک‌ها
              </Link>
            </>
          )}
        </section>
      )}
      <section className="tile" aria-label="شکایت‌های باز">
        <h2>شکایت‌های باز</h2>
        {data.complaints.length === 0 ? (
          <p>شکایت بازی ندارد.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {data.complaints.map((c) => (
              <li key={c.id}>
                {CATEGORY_LABEL[c.category as ComplaintCategory] ?? "سایر"} · شدت {SEVERITY_LABEL[c.severity as ComplaintSeverity] ?? "نامشخص"} ·{" "}
                {faJalaliDate(c.reported_at.slice(0, 10))}
                {c.status === "investigating" ? " · در حال بررسی" : ""}
                {c.description ? <><br /><small>{c.description}</small></> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
