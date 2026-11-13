"use client";

import ScrollFade from "@/components/mobile/ScrollFade";
import { FieldInput } from "@/components/FieldInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BusinessCard from "./BusinessCard";
import AfterCallFlow from "./AfterCallFlow";
import AddLeadFlow from "./AddLeadFlow";
import { useTutorialData } from "@/components/tutorials/TutorialProvider";
import { useCallReturn } from "./useCallReturn";
import CustomerSheet from "@/components/meridian/CustomerSheet";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import type { BusinessRow, CrmView } from "@/lib/repo/crm/businesses";
import { faDigits } from "@/lib/crm/vocab";
import { useFavourites } from "@/lib/useFavourites";
import { toggleFavourite as toggleId } from "@/lib/favourites";
import StickyAction from "@/components/mobile/StickyAction";
import { useToast } from "@/components/ToastProvider";
import { tehranTodayIso } from "@/lib/jalali";
import Link from "next/link";
import { actionsFor } from "@/lib/actionList";
import type { Role } from "@/lib/roles";

const VIEW_LABEL: Record<CrmView, string> = {
  today: "پیگیری امروز", hot: "داغ", my_leads: "سرنخ‌های من", my_customers: "مشتریان من",
  at_risk: "در خطر", unassigned: "بی‌صاحب", all: "همه",
};
const VIEW_ORDER: CrmView[] = ["today", "hot", "my_leads", "my_customers", "at_risk", "unassigned", "all"];
const NEXT_MODE: ReadonlySet<CrmView> = new Set<CrmView>(["today", "hot"]);

type CallFlow = { kind: "call"; customerId: number; entry: "call" | "talked_now"; open: boolean };
type LeadFlow = { kind: "lead"; open: boolean; prefillPhone: string | null };

export default function CrmBoard({ initialRows, initialCounts, initialView, canPlan, role }: {
  initialRows: BusinessRow[]; initialCounts: Record<CrmView, number>; initialView: CrmView;
  /** The roles whose API lets them add stops to the day plan (MANAGE_ROLES): only they get «انتخاب». */
  canPlan: boolean;
  role: Role;
}) {
  const mapAction = actionsFor(role, "customer-selection").find((a) => a.id === "customers-on-map");
  const [view, setView] = useState<CrmView>(initialView);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [counts, setCounts] = useState(initialCounts);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [call, setCall] = useState<CallFlow | null>(null);
  const [lead, setLead] = useState<LeadFlow | null>(null);
  const [sheet, setSheet] = useState<{ id: number; name?: string } | null>(null);
  const [navApp] = useNavApp();
  const [favs, toggleFav] = useFavourites();
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const stopSelecting = () => { setSelecting(false); setPicked([]); };
  async function addPickedToPlan() {
    setAdding(true);
    const results = await Promise.all(picked.map((id) =>
      fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: id, planned_date: tehranTodayIso() }),
      }).then((r) => r.ok).catch(() => false),
    ));
    const ok = results.filter(Boolean).length;
    toast(ok === picked.length ? `${faDigits(String(ok))} مشتری به برنامهٔ امروز اضافه شد.` : `${faDigits(String(ok))} از ${faDigits(String(picked.length))} مشتری اضافه شد؛ بقیه نشد.`, ok === picked.length ? "success" : "error");
    setAdding(false);
    stopSelecting();
  }
  // While a CRM tutorial runs the list shows its «نمونه» rows; the real ones come back after.
  const listed = useTutorialData("crm-rows", rows);
  const shown = onlyFavs ? listed.filter((r) => favs.includes(r.id)) : listed;

  const load = useCallback(async (v: CrmView, query: string) => {
    const j = (await fetch(`/api/crm/businesses?view=${v}&q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => null)) as
      { ok?: boolean; rows?: BusinessRow[]; counts?: Record<CrmView, number> } | null;
    if (j?.ok) { setRows(j.rows ?? []); setCounts(j.counts ?? initialCounts); }
  }, [initialCounts]);

  /* The page already rendered `initialRows` for `initialView` on the server; asking the API for the same
     list on mount cost a request at ~9 s on a slow phone for nothing. */
  const showingInitial = useRef(true);
  useEffect(() => {
    if (showingInitial.current) {
      showingInitial.current = false;
      return;
    }
    const t = window.setTimeout(() => void load(view, q), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [view, q, load]);

  const startCall = useCallReturn((customerId) => setCall({ kind: "call", customerId, entry: "call", open: true }));
  const finished = useCallback((id: number) => {
    setCall(null);
    setLead(null);
    setHighlight(id);
    void load(view, q);
  }, [load, view, q]);

  const onCall = (row: BusinessRow) => {
    if (call && call.customerId === row.id && !call.open) { setCall({ ...call, open: true }); return; } // resume a draft
    if (row.phone_norm) startCall(row.id, row.phone_norm);
  };
  const onNavigate = (row: BusinessRow) => {
    if (row.lat !== null && row.lng !== null) window.open(navigateUrl(navApp, { lat: row.lat, lng: row.lng }, row.business_name), "_blank", "noopener");
  };

  return (
    <div style={{ display: "grid", gap: 12, padding: "0 16px 96px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <FieldInput
            style={{
              flex: 1,
              paddingLeft: 14,
              paddingRight: 14,
              paddingTop: 13,
              paddingBottom: 13,
              borderRadius: "var(--radius-md)",
              border: "2px solid var(--border)",
              background: "var(--surface)",
              color: "var(--foreground)",
              font: "inherit",
              fontSize: "var(--text-sm)",
              width: "100%",
              boxSizing: "border-box",
              outline: "none",
              transition: "border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "none";
            }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو نام، تلفن، محله…"
            aria-label="جستجو"
            data-tour="crm:search"
          />
        </div>
        <button data-tour="open:add_lead" type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => setLead({ kind: "lead", open: true, prefillPhone: null })}>
        <Icon name="plus" size="md" />
        سرنخ تازه</button>
      </div>
      <ScrollFade className="crm-views" role="toolbar" aria-label="نمای فهرست" tour="crm:views">
        {VIEW_ORDER.map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            <Icon name="user" size="md" />
            {VIEW_LABEL[v]}<i>{faDigits(String(counts[v] ?? 0))}</i>
          </button>
        ))}
        <button type="button" aria-pressed={onlyFavs} onClick={() => setOnlyFavs((v) => !v)}>
          <Icon name="heart" size="md" filled={onlyFavs} />
          دلخواه‌ها<i>{faDigits(String(favs.length))}</i>
        </button>
        {shown.length > 0 && mapAction ? (
          // S14 + T14: the picked customers, or else the list as filtered, opened on the map; the action list says who may.
          <Link href={mapAction.href!(selecting && picked.length > 0 ? picked : shown.map((r) => r.id))} prefetch={false} className="inline-flex items-center gap-[var(--space-2)]" data-tour="crm:on-map">
            <Icon name={mapAction.icon} size="md" />
            {selecting && picked.length > 0 ? `${faDigits(String(picked.length))} انتخاب‌شده روی نقشه` : "فهرست روی نقشه"}
          </Link>
        ) : null}
        {canPlan ? (
          <button type="button" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            <Icon name={selecting ? "x" : "check"} size="md" />
            {selecting ? "لغو انتخاب" : "انتخاب"}
          </button>
        ) : null}
      </ScrollFade>
      <div className="crm-list" data-tour="crm:list">
        {shown.length === 0 ? <p className="tf-sub" style={{ textAlign: "center", padding: 24 }}>در این نما موردی نیست. نما یا عبارت جستجو را تغییر دهید.</p> : null}
        {shown.map((row) => (
          <BusinessCard key={row.id} row={row} favourite={favs.includes(row.id)} onFavourite={(r) => toggleFav(r.id)}
            selected={selecting ? picked.includes(row.id) : undefined} onSelect={selecting ? (r) => setPicked((cur) => toggleId(cur, r.id)) : undefined} mode={NEXT_MODE.has(view) ? "next" : "business"} highlight={highlight === row.id}
            onCall={onCall} onOpen={(r) => setSheet({ id: r.id, name: r.business_name })} onNavigate={onNavigate} />
        ))}
      </div>

      {call ? (
        <AfterCallFlow
          key={`${call.customerId}-${call.entry}`}
          customerId={call.customerId}
          entry={call.entry}
          open={call.open}
          onHide={() => setCall((c) => (c ? { ...c, open: false } : c))}
          onReopen={() => setCall((c) => (c ? { ...c, open: true } : c))}
          onFinished={finished}
          onRedial={(id, phone) => { setCall(null); startCall(id, phone); }}
          onSpawnLead={(phone) => { setCall(null); setLead({ kind: "lead", open: true, prefillPhone: phone }); }}
        />
      ) : null}
      {lead ? (
        <AddLeadFlow
          open={lead.open}
          prefillPhone={lead.prefillPhone}
          onHide={() => setLead((l) => (l ? { ...l, open: false } : l))}
          onReopen={() => setLead((l) => (l ? { ...l, open: true } : l))}
          onFinished={finished}
          onOpenExisting={(id) => { setLead(null); setSheet({ id }); }}
          onCallNow={(id, phone) => startCall(id, phone)}
          onOpenBusiness={(id) => setSheet({ id })}
          onTalkedNow={(id) => setCall({ kind: "call", customerId: id, entry: "talked_now", open: true })}
        />
      ) : null}
      {selecting && picked.length > 0 ? (
        <div data-has-primary-bar>
        <StickyAction
          icon="calendar-plus"
          label={`افزودن ${faDigits(String(picked.length))} مشتری به برنامهٔ امروز`}
          busy={adding ? "در حال افزودن…" : undefined}
          disabled={adding}
          onClick={() => void addPickedToPlan()}
        />
        </div>
      ) : null}
      <CustomerSheet customerId={sheet?.id ?? null} fallbackName={sheet?.name} onClose={() => setSheet(null)} />
    </div>
  );
}
