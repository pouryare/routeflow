"use client";

import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import StickyAction from "@/components/mobile/StickyAction";
import BottomSheet from "@/components/mobile/BottomSheet";
import { GoButton } from "@/components/tapflow/Answer";
import SlideConfirm from "@/components/mobile/SlideConfirm";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useToast } from "@/components/ToastProvider";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import type { CompanyDomainRow, CompanyRow } from "@/lib/repo/companies";
import CompanySheet from "./CompanySheet";

interface Data {
  companies: CompanyRow[];
  main_owner_only: boolean;
  arvan: { configured: boolean; server_ip: string | null };
}

const STATUS: Record<CompanyDomainRow["status"], { label: string; tone: string }> = {
  waiting_dns: { label: "منتظر DNS", tone: "text-warning" },
  waiting_arvan: { label: "منتظر آروان", tone: "text-warning" },
  active: { label: "فعال", tone: "text-success" },
  failed: { label: "خطا", tone: "text-crit" },
};

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return res.ok && data.ok ? null : friendlyError(data.error, "انجام نشد؛ دوباره تلاش کنید");
}

/** The «شرکت‌ها» page: every company, its addresses and how far each address has got. */
export default function CompaniesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CompanyRow | "new" | null>(null);
  const [adding, setAdding] = useState<CompanyRow | null>(null);
  const [checking, setChecking] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/companies");
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setData(json as Data);
      setError(null);
    } else setError(friendlyError(json.error, "شرکت‌ها بارگذاری نشد؛ دوباره تلاش کنید"));
  }, []);
  useRunAfterMount(load);

  const toast = useToast();
  // The reload comes first: it clears the error line, so the failure of this action must be set after it.
  // ok is the toast on success: most of these actions change nothing you can see.
  const act = async (p: Promise<string | null>, ok?: string) => {
    const err = await p;
    await load();
    setError(err);
    if (!err && ok) toast(ok, "success");
    return err;
  };

  return (
    <div className="sticky-action-gap flex flex-col gap-[var(--space-4)]">
      {error && (
        <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      )}
      {data === null ? (
        <p className="card p-[var(--space-4)] text-sm text-text-muted">در حال بارگذاری…</p>
      ) : (
        <>
          {data.companies.map((c) => (
            <CompanyCard key={c.id} c={c} arvan={data.arvan.configured} checking={checking} setChecking={setChecking} act={act} onAdd={() => setAdding(c)} onEdit={() => setSheet(c)} />
          ))}

          <details className="card p-[var(--space-4)] text-sm">
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 font-medium">
              <Icon name="help" size="sm" />
              مراحل راه‌اندازی یک نشانی
            </summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-text-muted">
              <li>نشانی را برای شرکت اضافه کنید. اگر کلید آروان روی سرور باشد، دامنه، رکورد A و HTTPS خودکار در آروان ساخته می‌شود؛ وگرنه «تنظیم در آروان» را بزنید.</li>
              <li>دو نیم‌سروری که زیر نشانی نوشته می‌شود را به مشتری بدهید تا یک بار در ثبت‌کنندهٔ دامنه‌اش بگذارد (این کار فقط دست خود مشتری است).</li>
              <li>اینجا «بررسی دوباره» را بزنید تا وضعیت «فعال» شود.</li>
            </ol>
          </details>

          <ArvanSection arvan={data.arvan} addresses={data.companies.reduce((n, c) => n + c.domains.length, 0)} act={act} />

          <section className="card flex flex-col gap-2 p-[var(--space-4)]">
            <h2 className="sechead__title m-0">نشانی اصلی سامانه</h2>
            <p className="m-0 text-sm text-text-muted">
              {data.main_owner_only
                ? "الان فقط مدیر سامانه می‌تواند در نشانی اصلی وارد شود. کاربران هر شرکت فقط از نشانی خودشان وارد می‌شوند."
                : "الان کاربران همهٔ شرکت‌ها هم می‌توانند در نشانی اصلی وارد شوند. وقتی همهٔ شرکت‌ها نشانی فعال دارند، آن را ببندید."}
            </p>
            <Button
              variant="secondary"
              className="min-h-[44px] self-start"
              onPress={() => act(send("/api/admin/main-address", "POST", { owner_only: !data.main_owner_only }), data.main_owner_only ? "نشانی اصلی برای همه باز شد" : "نشانی اصلی فقط برای مدیر سامانه شد")}
            >
              <Icon name={data.main_owner_only ? "unlink" : "key"} size="sm" />
              {data.main_owner_only ? "باز کردن برای همه" : "فقط مدیر سامانه"}
            </Button>
          </section>

          <StickyAction label="افزودن شرکت" icon="plus" onClick={() => setSheet("new")} />
        </>
      )}

      {data && sheet && (
        <CompanySheet
          key={sheet === "new" ? "new" : sheet.id}
          editing={sheet === "new" ? null : sheet}
          onClose={() => setSheet(null)}
          onAddAddress={sheet === "new" ? undefined : () => { setAdding(sheet); setSheet(null); }}
          onSaved={() => {
            setSheet(null);
            void load();
            toast("شرکت ذخیره شد", "success");
          }}
        />
      )}
      {adding && (
        <AddressSheet
          company={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void load();
            toast("نشانی ذخیره شد؛ وضعیتش روی کارت شرکت است", "success");
          }}
        />
      )}
    </div>
  );
}

function CompanyCard({ c, arvan, checking, setChecking, act, onAdd, onEdit }: {
  c: CompanyRow;
  arvan: boolean;
  checking: number | null;
  setChecking: (id: number | null) => void;
  act: (p: Promise<string | null>, ok?: string) => Promise<string | null>;
  onAdd: () => void;
  onEdit: () => void;
}) {
  return (

    <section className="card flex flex-col gap-2 p-[var(--space-4)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="sechead__title m-0 flex items-center gap-2">
          <Icon name="building" size="md" />
          {c.name}
        </h2>
        <span className={`text-xs ${c.active ? "text-success" : "text-crit"}`}>{c.active ? "فعال" : "غیرفعال"}</span>
      </div>
      <p className="m-0 text-xs text-text-muted">
        {faNum(c.users)} کاربر فعال{c.has_logo ? " · لوگو دارد" : " · بدون لوگو"}
      </p>

      {c.domains.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">هنوز نشانی ندارد؛ کاربران این شرکت نمی‌توانند وارد شوند.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {c.domains.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="ltr" className="text-sm">{d.hostname}</span>
                <span className={`text-xs ${STATUS[d.status].tone}`}>{STATUS[d.status].label}</span>
              </div>
              {d.status !== "active" && d.last_error && <span className="text-xs text-text-muted">{d.last_error}</span>}
              {d.last_checked_at && <span className="text-xs text-text-faint">آخرین بررسی: {faJalaliDateTime(d.last_checked_at)}</span>}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  isDisabled={checking === d.id}
                  onPress={async () => {
                    setChecking(d.id);
                    await act(send(`/api/admin/companies/${c.id}/domains/${d.id}/check`, "POST"), "وضعیت نشانی دوباره بررسی شد");
                    setChecking(null);
                  }}
                >
                  <Icon name="refresh" size="sm" />
                  {checking === d.id ? "در حال بررسی…" : "بررسی دوباره"}
                </Button>
                {arvan && (
                  <Button variant="secondary" className="min-h-[44px]" onPress={() => act(send(`/api/admin/companies/${c.id}/domains/${d.id}/arvan`, "POST"), "تنظیم در آروان انجام شد")}>
                    <Icon name="link" size="sm" />
                    تنظیم در آروان
                  </Button>
                )}
                <Button variant="secondary" className="min-h-[44px]" onPress={() => act(send(`/api/admin/companies/${c.id}/domains/${d.id}`, "DELETE"), "نشانی حذف شد")}>
                  <Icon name="trash" size="sm" />
                  حذف نشانی
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {c.domains.length === 0 && (
          <Button variant="secondary" className="min-h-[44px]" onPress={onAdd}>
            <Icon name="plus" size="sm" />
            افزودن نشانی
          </Button>
        )}
        <Button variant="secondary" className="min-h-[44px]" onPress={onEdit}>
          <Icon name="edit" size="sm" />
          ویرایش
        </Button>
        <Button variant="secondary" className="min-h-[44px]" onPress={() => act(send(`/api/admin/companies/${c.id}`, "PATCH", { active: !c.active }), c.active ? "شرکت غیرفعال شد" : "شرکت فعال شد")}>
          <Icon name={c.active ? "ban" : "check"} size="sm" />
          {c.active ? "غیرفعال کردن" : "فعال کردن"}
        </Button>
      </div>
    </section>

  );
}

function AddressSheet({ company, onClose, onSaved }: { company: CompanyRow; onClose: () => void; onSaved: () => void }) {
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet open onClose={onClose} title={`نشانی تازه برای «${company.name}»`} closeLabel="بستن فرم نشانی" dirty={!!hostname}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          نشانی
          <FieldInput dir="ltr" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="app.example.ir" autoCapitalize="off" />
        </label>
        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        <GoButton
          icon="save"
          isDisabled={busy || !hostname.trim()}
          onPress={async () => {
            setBusy(true);
            const err = await send(`/api/admin/companies/${company.id}/domains`, "POST", { hostname: hostname.trim() });
            setBusy(false);
            if (err) setError(err);
            else onSaved();
          }}
        >
          {busy ? "در حال ذخیره…" : "ذخیره نشانی"}
        </GoButton>
      </div>
    </BottomSheet>
  );
}

/** The server's address that every company address points at, and the Arvan shortcuts that act on all of them. */
function ArvanSection({ arvan, addresses, act }: { arvan: Data["arvan"]; addresses: number; act: (p: Promise<string | null>, ok?: string) => Promise<string | null> }) {
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card flex flex-col gap-2 p-[var(--space-4)]">
      <h2 className="sechead__title m-0">آروان و آدرس سرور</h2>
      {!arvan.configured && (
        <p className="m-0 text-sm text-text-muted">کلید آروان روی سرور تنظیم نشده (ARVAN_API_KEY)؛ مراحل آروان را باید خودتان در پنل آروان انجام دهید.</p>
      )}
      <p className="m-0 text-xs text-text-muted">
        IP عمومی سرور
        <bdi dir="ltr" className="block text-base text-text">{arvan.server_ip ?? "تنظیم نشده"}</bdi>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-[44px]" onPress={() => setChanging(true)}>
          <Icon name="refresh" size="sm" />
          تغییر IP سرور
        </Button>
        {arvan.configured && (
          <Button
            variant="secondary"
            className="min-h-[44px]"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              await act(send("/api/admin/arvan-purge", "POST"), "حافظهٔ موقت آروان خالی شد");
              setBusy(false);
            }}
          >
            <Icon name="sparkle" size="sm" />
            خالی کردن حافظهٔ موقت
          </Button>
        )}
      </div>
      {changing && <ServerIpSheet current={arvan.server_ip} addresses={addresses} act={act} onClose={() => setChanging(false)} />}
    </section>
  );
}

// shortcut: the same pattern as app/api/admin/server-ip/route.ts; share it from lib/ when a third place needs it.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** New server IP: type it, then slide to confirm. The slide is there because it moves every company address in Arvan at once. */
function ServerIpSheet({ current, addresses, act, onClose }: { current: string | null; addresses: number; act: (p: Promise<string | null>, ok?: string) => Promise<string | null>; onClose: () => void }) {
  const [ip, setIp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = IPV4.test(ip.trim()) && ip.trim() !== current;
  return (
    <BottomSheet open onClose={onClose} title="تغییر IP سرور" closeLabel="بستن" dirty={!!ip}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          IP تازهٔ سرور
          <FieldInput dir="ltr" inputMode="decimal" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="185.1.2.3" autoCapitalize="off" />
        </label>
        <p className="m-0 text-sm text-text-muted">
          {addresses > 0 ? `${faNum(addresses)} نشانی شرکت‌ها در آروان یک‌جا به این IP منتقل می‌شوند.` : "هنوز نشانی‌ای ثبت نشده؛ فقط IP ذخیره می‌شود."}
        </p>
        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        <SlideConfirm
          isDisabled={!valid}
          onConfirm={async () => {
            const err = await act(send("/api/admin/server-ip", "POST", { ip: ip.trim() }), "IP سرور ذخیره شد");
            if (err) setError(err);
            else onClose();
          }}
        >
          بکشید تا IP عوض شود
        </SlideConfirm>
      </div>
    </BottomSheet>
  );
}
