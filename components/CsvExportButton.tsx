"use client";

import { toCsv } from "@/lib/csv";
import { useToast } from "./ToastProvider";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface CustomerRow {
  business_name: string;
  customer_code: string;
  status: string | null;
  salesperson: string | null;
  phone: string | null;
  address: string | null;
  debt_0_7: number;
  debt_8_30: number;
  debt_30_plus: number;
  last_purchase_date: string | null;
}

interface DistrictRow {
  name: string;
  level: string;
  parent_name: string | null;
  coverage_status: string;
  assigned_to: string | null;
}

export default function CsvExportButton({
  customers,
  districts,
}: {
  customers: CustomerRow[];
  districts: DistrictRow[];
}) {
  const toast = useToast();

  function exportCustomers() {
    const rows = [
      ["نام کسب‌وکار", "کد مشتری", "وضعیت", "فروشنده", "تلفن", "آدرس", "بدهی ۰-۷", "بدهی ۸-۳۰", "بدهی ۳۰+", "آخرین خرید"],
      ...customers.map((c) => [
        c.business_name,
        c.customer_code,
        c.status,
        c.salesperson,
        c.phone,
        c.address,
        c.debt_0_7,
        c.debt_8_30,
        c.debt_30_plus,
        c.last_purchase_date,
      ]),
    ];
    download("مشتریان.csv", toCsv(rows));
    toast(`CSV با ${customers.length} مشتری دانلود شد.`, "success");
  }

  function exportDistricts() {
    const rows = [
      ["نام", "سطح", "منطقه بالادست", "وضعیت", "مسئول"],
      ...districts.map((d) => [d.name, d.level, d.parent_name, d.coverage_status, d.assigned_to]),
    ];
    download("مناطق.csv", toCsv(rows));
    toast(`CSV با ${districts.length} منطقه دانلود شد.`, "success");
  }

  return (
    <div className="no-print flex gap-2">
      <button
        onClick={exportCustomers}
        className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
      >
        CSV مشتریان
      </button>
      <button
        onClick={exportDistricts}
        className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
      >
        CSV مناطق
      </button>
    </div>
  );
}
