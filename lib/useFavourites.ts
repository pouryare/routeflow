"use client";

import { useCallback, useState } from "react";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { CUSTOMER_FAVOURITES_KEY, parseFavourites, toggleFavourite } from "@/lib/favourites";

/** The favourite customer ids of this phone. shortcut: kept in this browser only, not per account or across
 *  devices; move it to the server (a table keyed by user) if people want their hearts on every device. */
export function useFavourites(): [number[], (id: number) => void] {
  const [list, setList] = useState<number[]>([]);
  const read = useCallback(() => {
    try {
      setList(parseFavourites(localStorage.getItem(CUSTOMER_FAVOURITES_KEY)));
    } catch {
      /* storage blocked: no favourites */
    }
  }, []);
  useRunAfterMount(read);
  const toggle = useCallback((id: number) => {
    setList((cur) => {
      const next = toggleFavourite(cur, id);
      try {
        localStorage.setItem(CUSTOMER_FAVOURITES_KEY, JSON.stringify(next));
      } catch {
        /* not kept */
      }
      return next;
    });
  }, []);
  return [list, toggle];
}
