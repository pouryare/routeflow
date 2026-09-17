"use client";

import { Icon } from "@/components/meridian/Icon";
import type { BusinessRow } from "@/lib/repo/crm/businesses";
import { labelDue } from "@/lib/crm/due";
import { formatPhone } from "@/lib/crm/phone";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABEL, CONTACT_ROLES, CONTACT_ROLE_LABEL, SALES_STAGES, SALES_STAGE_LABEL, isOneOf,
} from "@/lib/crm/vocab";

/** "next" mode is the pocket card (the task is the headline) for the follow-up views;
 *  "business" mode leads with the business, for browsing. Two buttons only: Call, Open. */
export default function BusinessCard({ row, mode, highlight, onCall, onOpen, onNavigate }: {
  row: BusinessRow; mode: "next" | "business"; highlight: boolean;
  onCall: (row: BusinessRow) => void; onOpen: (row: BusinessRow) => void; onNavigate: (row: BusinessRow) => void;
}) {
  const now = new Date().toISOString();
  const overdue = !!row.next_due_at && row.next_due_at < now;
  const stage = isOneOf(SALES_STAGES, row.sales_stage) ? SALES_STAGE_LABEL[row.sales_stage] : SALES_STAGE_LABEL.unknown;
  const type = isOneOf(BUSINESS_TYPES, row.business_type) ? BUSINESS_TYPE_LABEL[row.business_type] : null;
  const role = isOneOf(CONTACT_ROLES, row.contact_role) ? CONTACT_ROLE_LABEL[row.contact_role] : null;
  const contact = [row.contact_name, role].filter(Boolean).join(" · ") || "هنوز کسی را نمی‌شناسیم";
  const unverified = (row.verification ?? "unverified") === "unverified";
  const nextLine = row.next_title ? `${row.next_due_at ? labelDue(row.next_due_at, now) : ""} · ${row.next_title.split(" · ")[0]}` : "کار بعدی ندارد";

  return (
    <article className={`crm-card${highlight ? " hl" : ""}`}>
      <div className={`due${overdue ? " over" : ""}`}>{mode === "next" ? nextLine : [type, row.area_label].filter(Boolean).join(" · ")}</div>
      <p className="title">{mode === "next" ? (row.next_title?.split(" · ")[0] ?? row.business_name) : row.business_name}</p>
      <div className="meta">
        <span><span className={`dot ${row.temperature ?? "cold"}`} />{mode === "next" ? row.business_name : contact}</span>
        <span className="pills">
          {unverified ? <span className="pill warn">اطلاعات تأییدنشده</span> : null}
          {!row.phone_norm ? <span className="pill warn">بدون تلفن</span> : null}
          <span className="pill">{stage}</span>
        </span>
      </div>
      {mode === "business" && row.next_title ? <div className="due">{nextLine}</div> : null}
      <div className="acts">
        {row.phone_norm ? (
          <button type="button" className="btn solid" onClick={() => onCall(row)} aria-label={`تماس با ${formatPhone(row.phone_norm)}`}>
            <Icon name="phone" size="sm" /> تماس
          </button>
        ) : (
          <button type="button" className="btn solid" onClick={() => onNavigate(row)} disabled={row.lat === null}>
            <Icon name="route" size="sm" /> مسیریابی
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => onOpen(row)}>باز کن</button>
      </div>
    </article>
  );
}
