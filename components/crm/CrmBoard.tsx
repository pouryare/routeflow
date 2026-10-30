"use client";

import { FieldInput } from "@/components/FieldInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BusinessCard from "./BusinessCard";
import AfterCallFlow from "./AfterCallFlow";
import AddLeadFlow from "./AddLeadFlow";
import { useCallReturn } from "./useCallReturn";
import CustomerSheet from "@/components/meridian/CustomerSheet";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import type { BusinessRow, CrmView } from "@/lib/repo/crm/businesses";
import { faDigits } from "@/lib/crm/vocab";

const VIEW_LABEL: Record<CrmView, string> = {
  today: "پیگیری امروز", hot: "داغ", my_leads: "سرنخ‌های من", my_customers: "مشتریان من",
  at_risk: "در خطر", unassigned: "بی‌صاحب", all: "همه",
};
const VIEW_ORDER: CrmView[] = ["today", "hot", "my_leads", "my_customers", "at_risk", "unassigned", "all"];
const NEXT_MODE: ReadonlySet<CrmView> = new Set<CrmView>(["today", "hot"]);

type CallFlow = { kind: "call"; customerId: number; entry: "call" | "talked_now"; open: boolean };
type LeadFlow = { kind: "lead"; open: boolean; prefillPhone: string | null };

export default function CrmBoard({ initialRows, initialCounts, initialView }: {
  initialRows: BusinessRow[]; initialCounts: Record<CrmView, number>; initialView: CrmView;
}) {
  const [view, setView] = useState<CrmView>(initialView);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [counts, setCounts] = useState(initialCounts);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [call, setCall] = useState<CallFlow | null>(null);
  const [lead, setLead] = useState<LeadFlow | null>(null);
  const [sheet, setSheet] = useState<{ id: number; name?: string } | null>(null);
  const [navApp] = useNavApp();

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
              color: "var(--text)",
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
          />
        </div>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => setLead({ kind: "lead", open: true, prefillPhone: null })}>
        <Icon name="plus" size="md" />
        سرنخ تازه</button>
      </div>
      <div className="crm-views" role="toolbar" aria-label="نمای فهرست">
        {VIEW_ORDER.map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            <Icon name="user" size="md" />
            {VIEW_LABEL[v]}<i>{faDigits(String(counts[v] ?? 0))}</i>
          </button>
        ))}
      </div>
      <div className="crm-list">
        {rows.length === 0 ? <p className="tf-sub" style={{ textAlign: "center", padding: 24 }}>در این نما موردی نیست. نما یا عبارت جستجو را تغییر دهید.</p> : null}
        {rows.map((row) => (
          <BusinessCard key={row.id} row={row} mode={NEXT_MODE.has(view) ? "next" : "business"} highlight={highlight === row.id}
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
      <CustomerSheet customerId={sheet?.id ?? null} fallbackName={sheet?.name} onClose={() => setSheet(null)} />
    </div>
  );
}
