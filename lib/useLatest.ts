"use client";

import { useEffect, useRef, type RefObject } from "react";

/** A ref that always holds the newest value, for effects that must NOT re-run when it
 *  changes.
 *
 *  The planner and leads maps build a Leaflet routing control once per map and route key,
 *  and report its summary through an `onSummary` callback the parent recreates on every
 *  render. Listing the callback as a dependency would tear the control down and rebuild
 *  it on every render; leaving it out needed an `eslint-disable` for exhaustive-deps and
 *  kept whichever callback existed when the control was built. Reading it through this
 *  ref gives the control the current callback without rebuilding it. The ref is updated
 *  after each commit, never during render. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
