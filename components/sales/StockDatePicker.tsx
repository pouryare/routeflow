"use client";

import { useRouter } from "next/navigation";
import DateReel from "@/components/mobile/DateReel";

/** D9: pick the day; the page below re-reads the stock for it. */
export default function StockDatePicker({ value }: { value: string }) {
  const router = useRouter();
  return <DateReel value={value} onChange={(iso) => { if (iso !== value) router.replace(`/sales/stock/on-date?date=${iso}`); }} />;
}
