"use client";

import { useEffect } from "react";
import { pretendBody, pretendFor, setPretending } from "@/lib/tutorials/pretend";

/** While `pretend` is true, window.fetch answers writes in the browser and never sends them. */
export function usePretendSaves(pretend: boolean) {
  useEffect(() => {
    if (!pretend) return;
    setPretending(true);
    const real = window.fetch;
    let n = 0;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (pretendFor(method, url) === "fake") {
        n += 1;
        return Promise.resolve(new Response(JSON.stringify(pretendBody(n)), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init);
    };
    return () => {
      window.fetch = real;
      setPretending(false);
    };
  }, [pretend]);
}
