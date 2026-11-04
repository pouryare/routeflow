"use client";

import { useCallback, useRef, useState } from "react";
import { CUSTOMER_FAVOURITES_KEY, parseFavourites, toggleFavourite } from "@/lib/favourites";
import { useRunAfterMount } from "@/lib/useRunAfterMount";

const save = (list: number[]) =>
  fetch("/api/prefs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favourite_customers: list }),
  }).catch(() => null);

/** This person's favourite customer ids, kept on their account (users.prefs_json) so they follow them to
 *  every device. Hearts made earlier on this phone (kept in the browser before) are moved up to the account
 *  the first time the account has none. */
export function useFavourites(): [number[], (id: number) => void] {
  const [list, setList] = useState<number[]>([]);
  const latest = useRef<number[]>([]);
  const set = (next: number[]) => {
    latest.current = next;
    setList(next);
  };

  const load = useCallback(async () => {
    const body = (await fetch("/api/prefs").then((r) => r.json()).catch(() => null)) as { prefs?: { favourite_customers?: number[] } } | null;
    let mine = body?.prefs?.favourite_customers ?? [];
    if (mine.length === 0) {
      try {
        const local = parseFavourites(localStorage.getItem(CUSTOMER_FAVOURITES_KEY));
        if (local.length > 0 && body) {
          mine = local;
          void save(local);
        }
        localStorage.removeItem(CUSTOMER_FAVOURITES_KEY);
      } catch {
        /* storage blocked: nothing to move */
      }
    }
    set(mine);
  }, []);
  useRunAfterMount(load);

  const toggle = useCallback((id: number) => {
    const next = toggleFavourite(latest.current, id);
    latest.current = next;
    setList(next);
    void save(next);
  }, []);
  return [list, toggle];
}
