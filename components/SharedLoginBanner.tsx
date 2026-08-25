"use client";

import { useSyncExternalStore } from "react";

/** sessionStorage is per-tab and only ever written by the login form, which navigates
 *  immediately afterwards -- so there is no external change to subscribe to. */
function subscribe() {
  return () => {};
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem("shared_login") === "1";
  } catch {
    // Private mode, or storage blocked. Not worth failing the whole shell over.
    return false;
  }
}

/** Standing notice that the current session came in on the shared password rather than a
 *  named account (spec §2.5). It is deliberately not dismissible: the flag clears itself
 *  the moment someone logs in as themselves, so the only way to make it go away is to do
 *  the thing it is asking for.
 *
 *  useSyncExternalStore rather than an initialiser or an effect: this renders inside the
 *  server-rendered root layout, so it needs a server snapshot (`false`) that differs from
 *  the client's without tripping a hydration mismatch. Reading storage in the initialiser
 *  would mismatch; reading it in an effect would be a setState in an effect, which the
 *  react-hooks lint rules reject. */
export default function SharedLoginBanner() {
  const shared = useSyncExternalStore(subscribe, readFlag, () => false);

  if (!shared) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-xs text-warn"
    >
      ورود با رمز مشترک انجام شد. برای هر همکار یک حساب بسازید — این روش ورود به‌زودی حذف
      می‌شود.
    </div>
  );
}
