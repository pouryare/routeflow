"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface MyPosition {
  lat: number;
  lng: number;
  /** Metres of uncertainty, as reported by the device. Drawn as a circle rather than
   *  hidden: a 500m fix and a 5m fix look identical as a dot, and acting on the first as
   *  if it were the second is how you end up at the wrong end of a street. */
  accuracy: number;
  /** Degrees clockwise from north, or null when stationary or unsupported. */
  heading: number | null;
  /** When this fix arrived. Used to tell a live position from a stale one. */
  at: number;
}

export type PositionStatus = "idle" | "locating" | "active" | "denied" | "unavailable";

interface MyPositionValue {
  position: MyPosition | null;
  status: PositionStatus;
  error: string | null;
  /** Re-asks after a denial or a failure. The browser will only re-prompt if the user
   *  has since cleared the permission, but retrying is free and sometimes it is a
   *  timeout rather than a refusal. */
  retry: () => void;
}

const MyPositionContext = createContext<MyPositionValue>({
  position: null,
  status: "idle",
  error: null,
  retry: () => {},
});

/** One geolocation watch for the whole app.
 *
 *  Before this there were two half-solutions and no answer. The map's ◎ button did a
 *  one-shot getCurrentPosition and dropped a marker that then sat frozen at wherever you
 *  had been when you pressed it; the geofence watcher had a real continuous watch but
 *  only ran when that toggle was on, and never drew anything. So the ordinary state of
 *  the app was: no blue dot, and no way to get a live one.
 *
 *  This is always on, mounted at the root, and every map and list reads from it. One
 *  watch rather than one per consumer matters for a device that spends the working day
 *  in a vehicle: each additional watch is another wake-up of the same GPS chip.
 *
 *  Positions are published even when inaccurate -- filtering out a poor fix would leave
 *  the app claiming to know nothing while the device is telling it something. The
 *  accuracy travels with the fix instead, so each consumer can decide.
 */
const noSubscribe = () => () => {};

function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export function MyPositionProvider({ children }: { children: React.ReactNode }) {
  const [position, setPosition] = useState<MyPosition | null>(null);
  const [status, setStatus] = useState<PositionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const watchIdRef = useRef<number | null>(null);

  /* Whether this browser can locate at all is a fact about the browser, read as a
     snapshot: null on the server and the hydrating render (this provider sits in the root
     layout, where there is no navigator to ask), a real answer on the next render. */
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, () => null);

  useEffect(() => {
    if (!hasGeolocation()) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          at: pos.timestamp,
        });
        setStatus("active");
        setError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          setError("اجازه دسترسی به موقعیت داده نشد");
          return;
        }
        // Timeout and "position unavailable" are transient -- a tunnel, a cold start, a
        // phone that has not seen a satellite yet. The watch stays open, so a later fix
        // still arrives; the last known position is deliberately kept on screen rather
        // than blanked, because where you were thirty seconds ago is a far better answer
        // than nothing.
        setStatus((s) => (s === "active" ? s : "locating"));
        setError(err.code === err.TIMEOUT ? "دریافت موقعیت طول کشید" : "موقعیت در دسترس نیست");
      },
      {
        enableHighAccuracy: true,
        // No maximumAge: a cached fix from ten minutes ago is worse than useless in a
        // moving vehicle, because it looks exactly like a current one.
        maximumAge: 0,
        timeout: 20000,
      }
    );

    const id = watchIdRef.current;
    return () => {
      if (id !== null) navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setStatus((s) => (s === "active" ? s : "locating"));
    setAttempt((a) => a + 1);
  }, []);

  // A watch is asked for as soon as the browser can answer, so "idle" means "locating".
  const shownStatus: PositionStatus =
    canLocate === null ? status : !canLocate ? "unavailable" : status === "idle" ? "locating" : status;
  const shownError = canLocate === false ? "این مرورگر موقعیت‌یابی ندارد" : error;

  return (
    <MyPositionContext.Provider value={{ position, status: shownStatus, error: shownError, retry }}>
      {children}
    </MyPositionContext.Provider>
  );
}

export function useMyPosition(): MyPositionValue {
  return useContext(MyPositionContext);
}
