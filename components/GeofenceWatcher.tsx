"use client";

import { useLatest } from "@/lib/useLatest";
import { tehranTodayIso } from "@/lib/jalali";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { CustomerRow } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import { isPlaced } from "@/lib/facilityTypes";
import { distanceKm } from "@/lib/geo";
import { useToast } from "./ToastProvider";
import { useMyPosition } from "./MyPositionProvider";

const TRIGGER_RADIUS_KM = 0.15; // 150m
const FACILITY_RADIUS_KM = 0.25;
const LEAD_RADIUS_KM = 0.15;
const SNOOZE_MS = 30 * 60 * 1000;
const FACILITY_SNOOZE_MS = 6 * 60 * 60 * 1000;
const LEAD_SNOOZE_MS = 30 * 60 * 1000;

type Prompt =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "facility_arrive"; facility: FacilityRow }
  | { kind: "lead"; lead: { id: number; name: string; lat: number; lng: number } };

export default function GeofenceWatcher({
  enabled,
  facilitiesEnabled = false,
  customers,
  facilities = [],
  leads = [],
}: {
  enabled: boolean;
  facilitiesEnabled?: boolean;
  customers: CustomerRow[];
  facilities?: FacilityRow[];
  leads?: Array<{ id: number; name: string; lat: number; lng: number }>;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const promptRef = useLatest(prompt);
  const snoozedRef = useRef(new Map<string, number>());
  /* The "latest value" refs: the watch effect below re-subscribes only on
     [enabled, position], and reads these to see the current lists without tearing the
     subscription down every time a customer row changes. */
  const customersRef = useRef(customers);
  const facilitiesRef = useRef(facilities);
  const facilitiesEnabledRef = useRef(facilitiesEnabled);
  const leadsRef = useRef(leads);

  /* Written in an effect rather than during render. A ref mutated in the render body is
     not a pure render -- under StrictMode's double render and under a render React throws
     away, it writes anyway -- which is what react-hooks/refs objects to.
     This effect is declared BEFORE the watch effect on purpose: effects run in
     declaration order within a commit, so the refs are already fresh by the time the
     watch reads them, exactly as they were with the render-time assignment. */
  useEffect(() => {
    customersRef.current = customers;
    facilitiesRef.current = facilities;
    facilitiesEnabledRef.current = facilitiesEnabled;
    leadsRef.current = leads;
  });
  // Reads the app-wide watch rather than opening a second one. Two watches meant two
  // wake-ups of the same GPS chip for the same answer, and left this component as the
  // only thing that knew where the user was -- which is why the position vanished from
  // the rest of the app whenever this toggle was off.
  const { position } = useMyPosition();

  useEffect(() => {
    if (!enabled || !position) return;

    const now = Date.now();
    const here = { lat: position.lat, lng: position.lng };
    const notSnoozed = (key: string, window: number) => {
      const at = snoozedRef.current.get(key);
      return !at || now - at > window;
    };

    // Our own sites win a tie: standing in the warehouse yard, "log a restock" is a
    // more useful offer than a visit to whatever customer happens to be next door.
    if (facilitiesEnabledRef.current) {
      const site = facilitiesRef.current
        .filter(isPlaced)
        .map((f) => ({ f, km: distanceKm(here, f) }))
        .filter(({ f, km }) => km <= FACILITY_RADIUS_KM && notSnoozed(`facility:${f.id}`, FACILITY_SNOOZE_MS))
        .sort((a, b) => a.km - b.km)[0];
      if (site) {
        setPrompt((prev) => prev ?? { kind: "facility_arrive", facility: site.f });
        return;
      }
    }

    const match = customersRef.current
      .filter((c) => c.lat && c.lng)
      .map((c) => ({ c, km: distanceKm(here, { lat: c.lat as number, lng: c.lng as number }) }))
      .filter(({ c, km }) => km <= TRIGGER_RADIUS_KM && notSnoozed(`customer:${c.id}`, SNOOZE_MS))
      .sort((a, b) => a.km - b.km)[0];
    if (match) setPrompt((prev) => prev ?? { kind: "customer", customer: match.c });

    // Lead proximity check: notify when near a lead location.
    const shown = promptRef.current;
    if (!shown || shown.kind !== "lead") {
      const leadMatch = leadsRef.current
        .filter((l) => l.lat !== null && l.lng !== null)
        .map((l) => ({ l, km: distanceKm(here, { lat: l.lat, lng: l.lng }) }))
        .filter(({ l, km }) => km <= LEAD_RADIUS_KM && notSnoozed(`lead:${l.id}`, LEAD_SNOOZE_MS))
        .sort((a, b) => a.km - b.km)[0];
      if (leadMatch) {
        setPrompt((prev) => prev ?? { kind: "lead", lead: leadMatch.l });
      }
    }
    // Runs per fix. The lists are read through refs so a customer refresh does not
    // re-evaluate the geofence against a position that has not changed.
  }, [enabled, position, promptRef]);

  function promptKey(p: Prompt): string {
    return p.kind === "customer" ? `customer:${p.customer.id}` : p.kind === "facility_arrive" ? `facility:${p.facility.id}` : `lead:${p.lead.id}`;
  }

  function dismiss() {
    if (prompt) snoozedRef.current.set(promptKey(prompt), Date.now());
    setPrompt(null);
  }

  async function confirmVisit() {
    if (!prompt || prompt.kind !== "customer") return;
    const customer = prompt.customer;
    setSaving(true);
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: customer.id, planned_date: tehranTodayIso() }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetch(`/api/visit-plans/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        toast(`بازدید از «${customer.business_name}» ثبت شد.`, "success");
      } else {
        toast("بازدید ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.", "error");
      }
      snoozedRef.current.set(`customer:${customer.id}`, Date.now());
    } finally {
      setSaving(false);
      setPrompt(null);
    }
  }

  /** Records the arrival in the shared activity log rather than as a visit plan: a stop
   *  at our own depot is something that happened, not something that was planned. Feature
   *  12 reads these back as the day's start and end. */
  async function confirmFacilityStop() {
    if (!prompt || prompt.kind !== "facility_arrive") return;
    const facility = prompt.facility;
    setSaving(true);
    try {
      const res = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "facility",
          entity_id: facility.id,
          event_type: "note",
          note: facility.kind === "warehouse" ? "بارگیری از انبار" : "توقف در مبدأ",
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast(`حضور در «${facility.name}» ثبت شد.`, "success");
      } else {
        toast("حضور ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.", "error");
      }
      snoozedRef.current.set(`facility:${facility.id}`, Date.now());
    } finally {
      setSaving(false);
      setPrompt(null);
    }
  }

  async function confirmLeadVisit() {
    if (!prompt || prompt.kind !== "lead") return;
    const lead = prompt.lead;
    setSaving(true);
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "lead", entity_id: lead.id, planned_date: tehranTodayIso() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(`بازدید از «${lead.name}» ثبت شد.`, "success");
      } else {
        toast("بازدید ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.", "error");
      }
      snoozedRef.current.set(`lead:${lead.id}`, Date.now());
    } finally {
      setSaving(false);
      setPrompt(null);
    }
  }

  if (!prompt) return null;

  const record =
    prompt.kind === "customer" ? confirmVisit : prompt.kind === "lead" ? confirmLeadVisit : confirmFacilityStop;

  return (
    <Alert
      status="accent"
      dir="rtl"
      role="status"
      className="geofence-prompt pinned-bottom absolute left-1/2 z-[var(--z-prompt)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
    >
      <Alert.Indicator>
        <Icon name="map-pin" size="sm" />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>
          شما نزدیک{" "}
          {prompt.kind === "customer"
            ? prompt.customer.business_name
            : prompt.kind === "facility_arrive"
            ? prompt.facility.name
            : prompt.lead.name}{" "}
          هستید — {prompt.kind === "facility_arrive" ? "حضور ثبت شود؟" : "بازدید ثبت شود؟"}
        </Alert.Title>
        <div className="geofence-prompt__actions">
          <Button size="sm" variant="primary" className="flex-1" onPress={() => void record()} isDisabled={saving}>
            <Icon name="check" size="sm" />
            {saving ? (prompt.kind === "facility_arrive" ? "در حال ثبت حضور…" : "در حال ثبت بازدید…") : prompt.kind === "facility_arrive" ? "ثبت حضور" : "ثبت بازدید"}
          </Button>
          <Button size="sm" variant="tertiary" onPress={dismiss} isDisabled={saving}>
            <Icon name="arrow-left" size="sm" />
            فعلاً نه
          </Button>
        </div>
        <Alert.Description>
          {prompt.kind === "facility_arrive" ? "۶ ساعت دیگر دوباره می‌پرسیم." : "۳۰ دقیقهٔ دیگر دوباره می‌پرسیم."}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
