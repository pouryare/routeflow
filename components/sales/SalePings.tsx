"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faDigits, faToman } from "@/lib/format";
import { buzz } from "@/lib/haptic";
import { playSound } from "@/lib/sound";
import type { PingOrder } from "@/lib/salePings";

/** How often the open page asks for new orders, while it is visible. */
const CHECK_MS = 15_000;
/** How long a ping stays before it slides away. */
const SHOW_MS = 9_000;

interface Ping extends PingOrder {
  key: number;
}

/** «سفارش تازه»: orders landing while a manager or owner has the sales summary open.
 *
 *  Each new order drops in at the top as a card (newest brightest, older ones dim behind it)
 *  and the page's figures are refreshed, so the revenue digits roll to the new total. Nothing
 *  is announced for orders that already existed when the page opened. Checks only run while
 *  the tab is visible, so a phone in a pocket costs nothing. */
export default function SalePings() {
  const router = useRouter();
  const after = useRef<number | null>(null);
  const seq = useRef(0);
  const [pings, setPings] = useState<Ping[]>([]);

  useEffect(() => {
    let stopped = false;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/sales/pings${after.current === null ? "" : `?after=${after.current}`}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { latest: number; fresh: PingOrder[] };
        if (stopped) return;
        after.current = json.latest;
        if (json.fresh.length === 0) return;
        const added = json.fresh.map((o) => ({ ...o, key: ++seq.current }));
        setPings((p) => [...added, ...p].slice(0, 3));
        buzz(20);
        playSound("order.ping");
        router.refresh();
        for (const a of added) setTimeout(() => setPings((p) => p.filter((x) => x.key !== a.key)), SHOW_MS);
      } catch {
        /* offline: the next check tries again */
      }
    }
    void check();
    const t = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  if (pings.length === 0) return null;
  return (
    <ul className="pings" aria-live="polite">
      {pings.map((p) => (
        <li key={p.key} className="ping">
          <Link href={`/sales/orders/${p.id}`} className="ping__link">
            <Icon name="receipt" size="sm" />
            <span className="ping__text">
              <strong>سفارش تازه · {faDigits(p.order_no)}</strong>
              <span>{p.customer_name}</span>
            </span>
            <span className="ping__amount">{faToman(p.total_toman)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
