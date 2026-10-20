"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useMemo, useState } from "react";
import { faJalaliDateTime } from "@/lib/jalali";

const CATEGORY_LABEL: Record<string, string> = {
  spoilage: "فساد",
  packaging: "بسته‌بندی",
  foreign_object: "جسم خارجی",
  short_weight: "کسری وزن",
  wrong_product: "کالای اشتباه",
  other: "سایر",
};
const SEVERITY_LABEL: Record<string, string> = {
  low: "کم",
  medium: "متوسط",
  high: "زیاد",
  critical: "بحرانی",
};
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
  const [form, setForm] = useState(() => {
    let customer_id = "";
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("customer_id");
      if (q && /^\d+$/.test(q)) customer_id = q;
    }
    return { customer_id, product_id: "", category: "spoilage", severity: "medium", description: "" };
  });

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

  return (
    <div dir="rtl" className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">شکایات کیفی</h1>

      {clusters.length > 0 && (
        <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          خوشهٔ شکایت روی این سری‌های ساخت:{" "}
          {clusters.map((c) => `${c.batch_code} (${c.count})`).join("، ")} — بررسی شود.
        </div>
      )}

      <form onSubmit={file} className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-3">
        <select className="rounded border border-border bg-bg p-2 text-sm" value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
          <option value="">— مشتری —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.business_name ?? c.name}
            </option>
          ))}
        </select>
        <select className="rounded border border-border bg-bg p-2 text-sm" value={form.product_id} onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}>
          <option value="">— کالا —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.business_name}
            </option>
          ))}
        </select>
        <select className="rounded border border-border bg-bg p-2 text-sm" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="rounded border border-border bg-bg p-2 text-sm" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
          {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className="col-span-2 rounded border border-border bg-bg p-2 text-sm md:col-span-1" placeholder="توضیح" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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
                <td className="p-2">{label.customer(c.customer_id)}</td>
                <td className="p-2">{label.product(c.product_id)}</td>
                <td className="p-2">{CATEGORY_LABEL[c.category] ?? "نامشخص"}</td>
                <td className="p-2">{SEVERITY_LABEL[c.severity] ?? "نامشخص"}</td>
                <td className="p-2">{STATUS_LABEL[c.status] ?? "نامشخص"}</td>
                <td className="p-2">{faJalaliDateTime(c.reported_at)}</td>
                {canManage && (
                  <td className="p-2 text-left">
                    <div className="flex flex-wrap justify-end gap-1">
                      {["investigating", "resolved", "dismissed"]
                        .filter((s) => s !== c.status)
                        .map((s) => (
                          <button key={s} onClick={() => setStatus(c.id, s)} className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent">
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
    </div>
  );
}
