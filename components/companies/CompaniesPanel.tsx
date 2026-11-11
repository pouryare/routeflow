"use client";

import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import StickyAction from "@/components/mobile/StickyAction";
import BottomSheet from "@/components/mobile/BottomSheet";
import { GoButton } from "@/components/tapflow/Answer";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import type { CompanyDomainRow, CompanyRow } from "@/lib/repo/companies";
import CompanySheet from "./CompanySheet";

interface Data {
  companies: CompanyRow[];
  target: string | null;
  main_owner_only: boolean;
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

  const act = async (p: Promise<string | null>) => {
    const err = await p;
    setError(err);
    await load();
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
            <section key={c.id} className="card flex flex-col gap-2 p-[var(--space-4)]">
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
                            await act(send(`/api/admin/companies/${c.id}/domains/${d.id}/check`, "POST"));
                            setChecking(null);
                          }}
                        >
                          <Icon name="refresh" size="sm" />
                          {checking === d.id ? "در حال بررسی…" : "بررسی دوباره"}
                        </Button>
                        <Button variant="secondary" className="min-h-[44px]" onPress={() => act(send(`/api/admin/companies/${c.id}/domains/${d.id}`, "DELETE"))}>
                          <Icon name="trash" size="sm" />
                          حذف نشانی
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-[44px]" onPress={() => setAdding(c)}>
                  <Icon name="link" size="sm" />
                  افزودن نشانی
                </Button>
                <Button variant="secondary" className="min-h-[44px]" onPress={() => setSheet(c)}>
                  <Icon name="edit" size="sm" />
                  ویرایش
                </Button>
                <Button variant="secondary" className="min-h-[44px]" onPress={() => act(send(`/api/admin/companies/${c.id}`, "PATCH", { active: !c.active }))}>
                  <Icon name={c.active ? "ban" : "check"} size="sm" />
                  {c.active ? "غیرفعال کردن" : "فعال کردن"}
                </Button>
              </div>
            </section>
          ))}

          <details className="card p-[var(--space-4)] text-sm">
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 font-medium">
              <Icon name="help" size="sm" />
              مراحل راه‌اندازی یک نشانی
            </summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-text-muted">
              <li>مشتری در DNS دامنهٔ خودش یک رکورد CNAME از نشانی شرکت به <span dir="ltr">{data.target ?? "domains.<دامنهٔ شما>"}</span> می‌زند.</li>
              <li>شما همان نشانی را در پنل آروان اضافه می‌کنید.</li>
              <li>در این صفحه «بررسی دوباره» را بزنید تا وضعیت «فعال» شود.</li>
            </ol>
          </details>

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
              onPress={() => act(send("/api/admin/main-address", "POST", { owner_only: !data.main_owner_only }))}
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
          target={data.target}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
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
          }}
        />
      )}
    </div>
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
