"use client";

// The facilities behind the place picker, fetched only when it is actually opened.
//
// Not on mount. The picker is one control in a toolbar that most sessions never touch, and
// the list is a request to a MANAGE_ROLES-gated endpoint that a driver cannot read -- so
// fetching eagerly would either cost every user a request most of them cannot satisfy, or
// paper over that with a role check the picker does not otherwise need.
//
// A failed load is not an error the user has to see: they can still drop a pin on the map,
// which is the other path, and the panel's own empty state already says «هنوز مکانی ثبت
// نشده است» -- true from their point of view, since none of their places are listed.

import { useCallback, useRef, useState } from "react";
import type { FacilityRow } from "@/lib/facilityTypes";

export function useFacilities() {
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  // A ref, not state: the request must happen once per page even though two renders in a
  // row would otherwise both see an empty list and both fire.
  const started = useRef(false);

  const load = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    try {
      const res = await fetch("/api/facilities");
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.facilities)) setFacilities(body.facilities as FacilityRow[]);
    } catch {
      // Offline, or the endpoint is unreachable. The map path still works.
    }
  }, []);

  return { facilities, loadFacilities: load };
}