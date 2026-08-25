"use client";

import { toCsv } from "@/lib/csv";
import { useToast } from "./ToastProvider";
import { faNum } from "@/lib/format";

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
  /** Nearest of our own sites and the straight-line distance to it. Both null when the
   *  row has no coordinates, or when no sites are configured. */
  nearest_site: string | null;
  nearest_site_km: number | null;
}

interface DistrictRow {
  name: string;
  level: string;
  parent_name: string | null;
  coverage_status: string;
  nearest_site: string | null;
  nearest_site_km: number | null;
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
      // "خط مستقیم" is in the header because a spreadsheet column outlives the page it
      // came from -- whoever opens this next has no other way to know it is not drive
      // distance, and in Tehran the two differ by roughly a factor of two.
      ["نام کسب‌وکار", "کد مشتری", "وضعیت", "فروشنده", "تلفن", "آدرس", "بدهی ۰-۷", "بدهی ۸-۳۰", "بدهی ۳۰+", "آخرین خرید", "نزدیک‌ترین مکان ما", "فاصله (کیلومتر، خط مستقیم)"],
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
        c.nearest_site,
        c.nearest_site_km === null ? "" : c.nearest_site_km.toFixed(1),
      ]),
    ];
    download("مشتریان.csv", toCsv(rows));
    toast(`CSV با ${faNum(customers.length)} مشتری دانلود شد.`, "success");
  }

  function exportDistricts() {
    const rows = [
      ["نام", "سطح", "منطقه بالادست", "وضعیت", "نزدیک‌ترین مکان ما", "فاصله (کیلومتر، خط مستقیم)"],
      ...districts.map((d) => [
        d.name,
        d.level,
        d.parent_name,
        d.coverage_status,
        d.nearest_site,
        d.nearest_site_km === null ? "" : d.nearest_site_km.toFixed(1),
      ]),
    ];
    download("مناطق.csv", toCsv(rows));
    toast(`CSV با ${faNum(districts.length)} منطقه دانلود شد.`, "success");
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
