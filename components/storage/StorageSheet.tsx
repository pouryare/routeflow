"use client";

import { useState, type ReactNode } from "react";
import { ToggleButton } from "@heroui/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { GoButton } from "@/components/tapflow/Answer";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { toNumber } from "@/lib/money";
import { PLAN_CHOICES, WARN_CHOICES, planGb } from "@/lib/storage/view";
import type { PublicStorage } from "@/lib/repo/storages";

interface Preset {
  key: string;
  label: string;
  endpoint: string;
  region: string;
}

/** One required choice as chips (no dropdowns on a phone, docs/mobile-first-principles.md). */
export function Choice<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="filterchips__group filterchips__group--wrap" role="group" aria-label={label}>
        {options.map((o) => (
          <ToggleButton
            key={String(o.id)}
            className={`filterchip${value === o.id ? " filterchip--on" : ""}`}
            isSelected={value === o.id}
            onChange={() => onChange(o.id)}
          >
            <Icon name={value === o.id ? "check" : "dot"} size="sm" />
            {o.label}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}

const providerOptions = (presets: Preset[], devDisk: boolean) => [
  ...presets.map((p) => ({ id: p.key, label: p.label })),
  { id: "other", label: "S3 دیگر" },
  ...(devDisk ? [{ id: "local", label: "دیسک سرور (توسعه)" }] : []),
];

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      {children}
      {hint ? <span className="text-text-faint">{hint}</span> : null}
    </label>
  );
}

/** Add or edit one storage (decisions 4, 7, 14, 15, 22). Saving tests the storage on the server
 *  first; the authenticator code is asked by the app's step-up sheet. */
export default function StorageSheet({ open, onClose, onSaved, editing, others, presets, devDisk }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: PublicStorage | null;
  others: PublicStorage[];
  presets: Preset[];
  devDisk: boolean;
}) {
  const initialPreset = editing
    ? editing.kind === "local" ? "local" : presets.find((p) => p.endpoint === editing.endpoint)?.key ?? "other"
    : presets[0]?.key ?? "other";
  const [preset, setPreset] = useState<string>(initialPreset);
  const [name, setName] = useState(editing?.name ?? "");
  const [endpoint, setEndpoint] = useState(editing && initialPreset === "other" ? editing.endpoint ?? "" : "");
  const [region, setRegion] = useState(editing && initialPreset === "other" ? editing.region ?? "" : "");
  const [bucket, setBucket] = useState(editing?.bucket ?? "");
  const [accessKey, setAccessKey] = useState(editing?.access_key_id ?? "");
  const [secret, setSecret] = useState("");
  const [prefix, setPrefix] = useState(editing?.path_prefix ?? "routeflow/");
  const editingGb = planGb(editing?.plan_bytes ?? null);
  const [plan, setPlan] = useState<Plan>(
    editing ? (editingGb == null ? "none" : PLAN_CHOICES.some((c) => c.gb === editingGb) ? editingGb : "other") : 5,
  );
  const [planOther, setPlanOther] = useState(editingGb != null && !PLAN_CHOICES.some((c) => c.gb === editingGb) ? String(editingGb) : "");
  const [warn, setWarn] = useState<number>(editing?.warn_percent ?? 90);
  const [atLimit, setAtLimit] = useState<"keep" | "spill">(editing?.at_limit ?? "keep");
  const [overflow, setOverflow] = useState<number | null>(editing?.overflow_storage_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocal = preset === "local";
  const overflowChoices = others.filter((s) => s.id !== editing?.id && s.state === "active");
  const dirty = !editing ? !!(name || bucket || accessKey || secret) : !!secret || name !== editing.name;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        kind: isLocal ? "local" : "s3",
        preset: presets.some((p) => p.key === preset) ? preset : undefined,
        endpoint: preset === "other" ? endpoint.trim() : undefined,
        region: preset === "other" ? region.trim() : undefined,
        bucket: bucket.trim(),
        access_key_id: accessKey.trim(),
        secret: secret.trim() || undefined,
        path_prefix: prefix.trim(),
        plan_gb: plan === "none" ? null : plan === "other" ? toNumber(planOther) : plan,
        warn_percent: warn,
        at_limit: atLimit,
        overflow_storage_id: atLimit === "spill" ? overflow : null,
      };
      const res = await fetch(editing ? `/api/storages/${editing.id}` : "/api/storages", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "فضا ذخیره نشد؛ دوباره تلاش کنید"));
        return;
      }
      setSecret("");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editing ? `ویرایش «${editing.name}»` : "افزودن فضای ذخیره‌سازی"}
      closeLabel="بستن فرم فضا"
      dirty={dirty}
      expandable
    >
      <div className="flex flex-col gap-[var(--space-3)]">
        {!isLocal && <ArvanGuide />}

        {!editing && <Choice label="کجا" options={providerOptions(presets, devDisk)} value={preset} onChange={setPreset} />}

        <Field label="نام این فضا" hint="مثلاً «تهران اصلی» یا «کپی تبریز»">
          <FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="تهران اصلی" />
        </Field>

        {preset === "other" && <EndpointFields endpoint={endpoint} setEndpoint={setEndpoint} region={region} setRegion={setRegion} />}

        {!isLocal && (
          <>
            <Field label="نام باکت">
              <FieldInput dir="ltr" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="pakhsh-photos" autoCapitalize="off" />
            </Field>
            <Field label="کلید دسترسی (Access key)">
              <FieldInput dir="ltr" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoComplete="off" autoCapitalize="off" />
            </Field>
            <Field
              label="کلید مخفی (Secret key)"
              hint={editing?.secret_last4 ? `کلید فعلی: ••••${editing.secret_last4}. برای عوض کردن کلید، کلید تازه را بنویسید؛ خالی بماند همان می‌ماند.` : undefined}
            >
              <FieldInput dir="ltr" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
            </Field>
          </>
        )}

        <PlanChoices
          plan={plan}
          setPlan={setPlan}
          planOther={planOther}
          setPlanOther={setPlanOther}
          warn={warn}
          setWarn={setWarn}
          atLimit={atLimit}
          setAtLimit={setAtLimit}
          overflow={overflow}
          setOverflow={setOverflow}
          overflowChoices={overflowChoices}
        />

        {!isLocal && (
          <details className="text-sm">
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-text-muted">
              <Icon name="settings" size="sm" />
              بیشتر
            </summary>
            <Field label="پوشه داخل باکت" hint="اگر این باکت برای کارهای دیگر هم هست، فایل‌های برنامه در این پوشه می‌روند">
              <FieldInput dir="ltr" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </Field>
          </details>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        <GoButton icon="save" isDisabled={busy || !name.trim()} onPress={save}>
          {busy ? "در حال آزمایش…" : "آزمایش و ذخیره"}
        </GoButton>
      </div>
    </BottomSheet>
  );
}

/** Decision 21: the Persian setup steps, folded so they cost nothing once known. */
function ArvanGuide() {
  return (
    <details className="rounded-md border border-border bg-surface-2 p-3 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 font-medium">
        <Icon name="help" size="sm" />
        راهنما: ساخت باکت و کلید در آروان
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-text-muted">
        <li>در پنل آروان به «فضای ابری» بروید و یک باکت بسازید (مثلاً pakhsh-photos). دسترسی را «خصوصی» بگذارید.</li>
        <li>شهر باکت (تهران یا تبریز) را همین‌جا انتخاب کنید.</li>
        <li>از «کلیدهای دسترسی» یک کلید بسازید و Access key و Secret key را کپی کنید.</li>
        <li>اینجا بچسبانید و «آزمایش و ذخیره» را بزنید. برنامه یک فایل کوچک می‌نویسد، می‌خواند و پاک می‌کند.</li>
        <li>کلید مخفی بعد از ذخیره دیگر نشان داده نمی‌شود؛ فقط چهار حرف آخرش.</li>
      </ol>
    </details>
  );
}

type Plan = number | "none" | "other";

/** Plan size, warning level and what happens when full (decisions 13, 16, 17 and 22). */
function PlanChoices({ plan, setPlan, planOther, setPlanOther, warn, setWarn, atLimit, setAtLimit, overflow, setOverflow, overflowChoices }: {
  plan: Plan;
  setPlan: (v: Plan) => void;
  planOther: string;
  setPlanOther: (v: string) => void;
  warn: number;
  setWarn: (v: number) => void;
  atLimit: "keep" | "spill";
  setAtLimit: (v: "keep" | "spill") => void;
  overflow: number | null;
  setOverflow: (v: number) => void;
  overflowChoices: PublicStorage[];
}) {
  return (
    <>
      <Choice
        label="اندازهٔ طرح"
        options={[...PLAN_CHOICES.map((c) => ({ id: c.gb as Plan, label: c.label })), { id: "other", label: "سایر" }, { id: "none", label: "بدون حد" }]}
        value={plan}
        onChange={setPlan}
      />
      {plan === "other" && (
        <Field label="اندازهٔ طرح به گیگابایت">
          <FieldInput dir="ltr" inputMode="decimal" value={planOther} onChange={(e) => setPlanOther(e.target.value)} placeholder="50" />
        </Field>
      )}

      {plan !== "none" && (
        <>
          <Choice
            label="هشدار وقتی پر شد"
            options={WARN_CHOICES.map((w) => ({ id: w, label: `${faNum(w)}٪` }))}
            value={warn}
            onChange={setWarn}
          />
          <Choice
            label="وقتی پر شد"
            options={[
              { id: "keep" as const, label: "ادامه، هزینهٔ اضافه را می‌پردازم" },
              ...(overflowChoices.length ? [{ id: "spill" as const, label: "انتقال به فضای دیگر" }] : []),
            ]}
            value={atLimit}
            onChange={setAtLimit}
          />
          {atLimit === "spill" && (
            <Choice
              label="فایل‌های تازه به این فضا بروند"
              options={overflowChoices.map((s) => ({ id: s.id, label: s.name }))}
              value={overflow}
              onChange={setOverflow}
            />
          )}
        </>
      )}
    </>
  );
}

/** Endpoint and region for an S3 service that is not an Arvan preset. */
function EndpointFields({ endpoint, setEndpoint, region, setRegion }: {
  endpoint: string;
  setEndpoint: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
}) {
  return (
    <>
      <Field label="نشانی (endpoint)" hint="فقط دامنه، با https">
        <FieldInput dir="ltr" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.example.ir" inputMode="url" />
      </Field>
      <Field label="منطقه (region)" hint="اگر نمی‌دانید خالی بگذارید">
        <FieldInput dir="ltr" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
      </Field>
    </>
  );
}
