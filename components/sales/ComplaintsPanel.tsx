"use client";

import { FieldInput } from "@/components/FieldInput";
import DecisionDeck from "@/components/mobile/DecisionDeck";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { COMPLAINT_CHOICES, complaintRequest, complaintsToTriage } from "@/lib/decisions";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useMemo, useState } from "react";
import { faJalaliDateTime } from "@/lib/jalali";
import ComplaintFlow from "@/components/flows/ComplaintFlow";
import { autoOpenFlow, currentSearch } from "@/lib/flows/autoOpen";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/lib/flows/complaint";
import CustomerName from "@/components/CustomerName";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";

/* Category and severity words live with the flow that also uses them. Widened to plain string
   maps here because the rows below come from JSON, not from the server's unions. */
const CATEGORY_TEXT: Record<string, string> = CATEGORY_LABEL;
const SEVERITY_TEXT: Record<string, string> = SEVERITY_LABEL;
const STATUS_LABEL: Record<string, string> = {
  open: "باز",
  investigating: "در حال بررسی",
  resolved: "رفع‌شده",
  dismissed: "رد‌شده",
};

interface Named {
  id: number;
  business_name?: string;
  name?: string;
}

interface Complaint {
  id: number;
  customer_id: number | null;
  product_id: number | null;
  batch_id: number | null;
  category: string;
  severity: string;
  status: string;
  description: string | null;
  reported_at: string;
}

interface Cluster {
  batch_id: number;
  batch_code: string;
  count: number;
}

export default function ComplaintsPanel({
  customers,
  products,
  canManage,
}: {
  customers: Named[];
  products: Named[];
  canManage: boolean;
}) {
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [error, setError] = useState<string | null>(null);
  /* Phone entry is the tap flow, remounted per opening; the form below stays from md up. */
  const [flow, setFlow] = useState(() => autoOpenFlow("new", currentSearch()));
  const [form, setForm] = useState(() => {
    let customer_id = "";
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("customer_id");
      if (q && /^\d+$/.test(q)) customer_id = q;
    }
    return { customer_id, product_id: "", category: "spoilage", severity: "medium", description: "" };
  });

  const flowCustomers = useMemo(
    () => customers.map((c) => ({ id: c.id, business_name: c.business_name ?? c.name ?? "—" })),
    [customers],
  );
  const flowProducts = useMemo(
    () => products.map((p) => ({ id: p.id, name: p.name ?? p.business_name ?? "—" })),
    [products],
  );

  const label = useMemo(() => {
    const c = new Map(customers.map((x) => [x.id, x.business_name ?? x.name ?? "—"]));
    const p = new Map(products.map((x) => [x.id, x.name ?? x.business_name ?? "—"]));
    return { customer: (id: number | null) => (id ? c.get(id) ?? "—" : "—"), product: (id: number | null) => (id ? p.get(id) ?? "—" : "—") };
  }, [customers, products]);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/complaints");
    const body = await res.json().catch(() => null);
    if (res.ok) {
      setComplaints(body.complaints);
      setClusters(body.clusters ?? []);
    } else setComplaints([]);
  }, []);

  useRunAfterMount(load);

  async function file(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.description.trim()) {
      setError("شرح شکایت را بنویسید");
      return;
    }
    const res = await fetch("/api/sales/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        product_id: form.product_id ? Number(form.product_id) : null,
        category: form.category,
        severity: form.severity,
        description: form.description || null,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(friendlyError(body?.error, "شکایت ثبت نشد؛ دوباره تلاش کنید"));
      return;
    }
    setForm((f) => ({ ...f, description: "" }));
    void load();
  }

  async function setStatus(id: number, status: string) {
    const res = await fetch(`/api/sales/complaints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) void load();
    else setError(friendlyError((await res.json().catch(() => null))?.error, "تغییر وضعیت شکایت انجام نشد؛ دوباره تلاش کنید"));
  }

  /* «بررسی سریع»: complaints nobody has looked at, one card each, verdict in one tap with undo. */
  const undoable = useUndoableAction();
  const [deck, setDeck] = useState<{ key: number; open: boolean; items: Complaint[] }>({ key: 0, open: false, items: [] });
  const decideComplaint = (c: Complaint, status: string) =>
    undoable.run({
      message: `شکایت «${STATUS_LABEL[status] ?? "نامشخص"}» شد`,
      send: async () => {
        const res = await fetch(`/api/sales/complaints/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(complaintRequest(status)),
        });
        return res.ok ? { ok: true } : { ok: false, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error };
      },
      failure: "تغییر وضعیت شکایت انجام نشد؛ دوباره تلاش کنید",
      onDone: () => void load(),
    });

  return (
    <div dir="rtl" className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">شکایات کیفی</h1>

      {clusters.length > 0 && (
        <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          خوشهٔ شکایت روی این سری‌های ساخت:{" "}
          {clusters.map((c) => `${c.batch_code} (${c.count})`).join("، ")} — بررسی شود.
        </div>
      )}

      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-3 text-base font-medium text-accent-ink md:hidden"
      >
        <Icon name="plus" size="md" />
        ثبت شکایت جدید
      </button>

      {canManage && (
        <button
          type="button"
          onClick={() => setDeck((d) => ({ key: d.key + 1, open: true, items: complaintsToTriage(complaints ?? []) }))}
          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded border border-border px-4 py-3 text-base text-text md:hidden"
        >
          <Icon name="check" size="md" />
          بررسی سریع شکایت‌های باز
        </button>
      )}
      {deck.key > 0 && (
        <DecisionDeck
          key={deck.key}
          open={deck.open}
          title="شکایت‌های باز"
          items={deck.items}
          keyOf={(c) => c.id}
          choices={COMPLAINT_CHOICES}
          onDecide={decideComplaint}
          onClose={() => setDeck((d) => ({ ...d, open: false }))}
          render={(c) => (
            <>
              <strong>{label.customer(c.customer_id)}</strong>
              <span>{label.product(c.product_id)} · {CATEGORY_TEXT[c.category] ?? "نامشخص"} · {SEVERITY_TEXT[c.severity] ?? "نامشخص"}</span>
              {c.description ? <span className="text-text-muted">{c.description}</span> : null}
              <span className="text-text-muted">{faJalaliDateTime(c.reported_at)}</span>
            </>
          )}
        />
      )}

      <form onSubmit={file} className="hidden gap-3 rounded-lg border border-border bg-surface p-4 md:grid md:grid-cols-3">
        <SmartPicker scope="customers" label="مشتری" items={customers.map((c) => ({ id: String(c.id), label: String(c.business_name ?? c.name) }))} value={form.customer_id} onChange={(id) => setForm((f) => ({ ...f, customer_id: id }))} />
        <SmartPicker scope="products" label="کالا" items={products.map((p) => ({ id: String(p.id), label: String(p.name ?? p.business_name) }))} value={form.product_id} onChange={(id) => setForm((f) => ({ ...f, product_id: id }))} clearLabel="بدون کالا" />
        <ChipGroup wrap group={{ id: "category", label: "دستهٔ شکایت", mode: "single", neutral: "__none", value: form.category, onChange: (v) => { if (v !== "__none") setForm((f) => ({ ...f, category: v as string })); }, options: Object.entries(CATEGORY_TEXT).map(([k, v]) => ({ id: k, label: v })) }} />
        <ChipGroup wrap group={{ id: "severity", label: "شدت شکایت", mode: "single", neutral: "__none", value: form.severity, onChange: (v) => { if (v !== "__none") setForm((f) => ({ ...f, severity: v as string })); }, options: Object.entries(SEVERITY_TEXT).map(([k, v]) => ({ id: k, label: v })) }} />
        <label className="flex flex-col gap-1 text-xs text-text-muted col-span-2 md:col-span-1">توضیح<FieldInput className="w-full" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
        <button type="submit" className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-2 text-sm text-white">
          <Icon name="check" size="md" />
          ثبت شکایت
        </button>
        {error && <p className="col-span-full text-sm text-danger">{error}</p>}
      </form>

      {complaints === null ? (
        <p className="text-sm text-text-muted">در حال بارگذاری…</p>
      ) : complaints.length === 0 ? (
        <p className="text-sm text-text-muted">شکایتی ثبت نشده است.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-text-faint">
            <tr>
              <th className="p-2 text-right">مشتری</th>
              <th className="p-2 text-right">کالا</th>
              <th className="p-2 text-right">دسته</th>
              <th className="p-2 text-right">شدت</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">تاریخ</th>
              {canManage && <th className="p-2" />}
            </tr>
          </thead>
          <tbody>
            {complaints.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="p-2"><CustomerName id={c.customer_id} name={label.customer(c.customer_id)} /></td>
                <td className="p-2">{label.product(c.product_id)}</td>
                <td className="p-2">{CATEGORY_TEXT[c.category] ?? "نامشخص"}</td>
                <td className="p-2">{SEVERITY_TEXT[c.severity] ?? "نامشخص"}</td>
                <td className="p-2">{STATUS_LABEL[c.status] ?? "نامشخص"}</td>
                <td className="p-2">{faJalaliDateTime(c.reported_at)}</td>
                {canManage && (
                  <td className="p-2 text-left">
                    <div className="flex flex-wrap justify-end gap-1">
                      {["investigating", "resolved", "dismissed"]
                        .filter((s) => s !== c.status)
                        .map((s) => (
                          <button key={s} onClick={() => setStatus(c.id, s)} className="rounded border border-border px-2 py-0.5 touch text-xs hover:border-accent">
                            <Icon name="warn" size="md" />
                            {STATUS_LABEL[s]}
                          </button>
                        ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {flow.key > 0 && (
        <ComplaintFlow
          key={flow.key}
          open={flow.open}
          customers={flowCustomers}
          products={flowProducts}
          customerId={form.customer_id ? Number(form.customer_id) : undefined}
          onRecorded={() => void load()}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
