"use client";

import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import StickyAction from "@/components/mobile/StickyAction";
import BottomSheet from "@/components/mobile/BottomSheet";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "@/lib/storage/driver";
import { BAD_EVENTS, EVENT_LABEL, faBytes, providerLabel, usagePercent, usageTone } from "@/lib/storage/view";
import type { EventRow, MoveRow, PublicStorage, RuleRow } from "@/lib/repo/storages";
import StorageSheet, { Choice } from "./StorageSheet";
import StorageProblems from "./StorageProblems";
import StorageTrash from "./StorageTrash";

interface Data {
  storages: PublicStorage[];
  rules: RuleRow[];
  moves: MoveRow[];
  events: EventRow[];
  presets: { key: string; label: string; endpoint: string; region: string }[];
  dev_disk: boolean;
}

const TONE_COLOR = { none: "var(--accent)", ok: "var(--good)", warn: "var(--warn)", over: "var(--warn)" } as const;

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return res.ok && data.ok ? null : friendlyError(data.error, "انجام نشد؛ دوباره تلاش کنید");
}

/** The «فضای ذخیره‌سازی» page (docs/storage.md section 6). */
export default function StoragePanel({ isPlatform, allCompanies }: { isPlatform: boolean; allCompanies: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PublicStorage | "new" | null>(null);
  const [removing, setRemoving] = useState<PublicStorage | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const load = useCallback(async () => {
    if (allCompanies) return;
    const res = await fetch("/api/storages");
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setData(json as Data);
      setError(null);
    } else setError(friendlyError(json.error, "فضاها بارگذاری نشد؛ دوباره تلاش کنید"));
  }, [allCompanies]);
  useRunAfterMount(load);

  const act = async (p: Promise<string | null>) => {
    const err = await p;
    setError(err);
    await load();
    return err;
  };

  if (allCompanies) {
    return (
      <div className="flex flex-col gap-[var(--space-4)]">
        {isPlatform && <StorageProblems />}
        <p className="card p-[var(--space-4)] text-sm text-text-muted">
          فضاهای ذخیره‌سازی مال هر شرکت جداست. برای دیدن یا تغییر فضاهای یک شرکت، از «ورود به‌عنوان…» آن شرکت را انتخاب کنید.
        </p>
      </div>
    );
  }

  const storages = data?.storages ?? [];
  const byId = (id: number | null) => storages.find((s) => s.id === id);
  const defaultId = data?.rules.find((r) => r.file_kind === "*")?.storage_id ?? null;

  return (
    <div className="sticky-action-gap flex flex-col gap-[var(--space-4)]">
      {isPlatform && <StorageProblems />}
      {error && (
        <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      )}

      {data === null ? (
        <p className="card p-[var(--space-4)] text-sm text-text-muted">در حال بارگذاری…</p>
      ) : storages.length === 0 ? (
        <section className="card flex flex-col gap-2 p-[var(--space-4)]">
          <h2 className="sechead__title flex items-center gap-2">
            <Icon name="warn" size="md" />
            هنوز فضایی ندارید
          </h2>
          <p className="text-sm text-text-muted">
            عکس‌ها و رسیدهای شرکت در فضای ذخیره‌سازی خودتان (مثلاً آروان) نگه داشته می‌شود. تا یک فضا اضافه نکنید، دکمه‌های عکس و رسید برای همه
            غیرفعال است.
          </p>
        </section>
      ) : (
        storages.map((s) => (
          <StorageCard key={s.id} s={s} isDefault={s.id === defaultId} onEdit={() => setSheet(s)} onRemove={() => setRemoving(s)} />
        ))
      )}

      {data && storages.length > 0 && <RulesCard data={data} onSave={(rules, move) => act(send("/api/storages/rules", "PUT", { rules, move_existing: move }))} />}

      {data?.moves.map((m) => (
        <MoveCard
          key={m.id}
          m={m}
          fromName={byId(m.from_storage_id)?.name ?? "دیسک سرور"}
          toName={byId(m.to_storage_id)?.name ?? "؟"}
          onClose={(deleteOld) => act(send(`/api/storages/moves/${m.id}`, "POST", { delete_old: deleteOld }))}
        />
      ))}

      {data && (
        <section className="card flex flex-col gap-2 p-[var(--space-4)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="sechead__title">گزارش</h2>
            <Button variant="secondary" className="min-h-[44px]" onPress={() => setTrashOpen(true)}>
              <Icon name="trash" size="sm" />
              سطل زباله (۳۰ روز)
            </Button>
          </div>
          {data.events.length === 0 ? (
            <p className="text-sm text-text-muted">هنوز چیزی ثبت نشده.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.events.slice(0, 20).map((e) => (
                <li key={e.id} className="flex flex-col border-b border-border py-2 text-sm last:border-b-0">
                  <span className={BAD_EVENTS.has(e.kind) ? "text-crit" : "text-text"}>
                    {EVENT_LABEL[e.kind]}
                    {e.storage_name ? ` · ${e.storage_name}` : ""}
                  </span>
                  <span className="text-xs text-text-faint">
                    {faJalaliDateTime(e.created_at)}
                    {e.user_name ? ` · ${e.user_name}` : ""}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <StickyAction label="افزودن فضا" icon="plus" onClick={() => setSheet("new")} />
      )}

      {data && sheet && (
        <StorageSheet
          key={sheet === "new" ? "new" : sheet.id}
          open
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
          editing={sheet === "new" ? null : sheet}
          others={storages}
          presets={data.presets}
          devDisk={data.dev_disk}
        />
      )}

      {removing && (
        <RemoveSheet
          storage={removing}
          others={storages.filter((s) => s.id !== removing.id && s.state === "active")}
          onClose={() => setRemoving(null)}
          onRemove={async (to) => {
            const err = await act(send(`/api/storages/${removing.id}${to ? `?to=${to}` : ""}`, "DELETE"));
            if (!err) setRemoving(null);
            return err;
          }}
        />
      )}
      {trashOpen && <StorageTrash open onClose={() => setTrashOpen(false)} onRestored={load} />}
    </div>
  );
}


/** One storage: health dot, usage against the plan, last check, edit and remove. */
function StorageCard({ s, isDefault, onEdit, onRemove }: { s: PublicStorage; isDefault: boolean; onEdit: () => void; onRemove: () => void }) {
  const tone = usageTone(s);
  return (
  <section className="card flex flex-col gap-2 p-[var(--space-4)]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="sechead__title flex items-center gap-2">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ background: s.last_check_error ? "var(--crit)" : "var(--good)" }}
          aria-label={s.last_check_error ? "کار نمی‌کند" : "کار می‌کند"}
        />
        {s.name}
      </h2>
      <span className="flex flex-wrap gap-1">
        {isDefault && <span className="pill done">پیش‌فرض</span>}
        {s.state === "moving_out" && <span className="pill conf">در حال انتقال و حذف</span>}
      </span>
    </div>
    <p className="text-xs text-text-muted">
      {providerLabel(s)}
      {s.bucket ? <> · <span dir="ltr">{s.bucket}</span></> : null}
      {s.secret_last4 ? <> · کلید <span dir="ltr">••••{s.secret_last4}</span></> : null}
    </p>
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>
          {faBytes(s.used_bytes)}
          {s.plan_bytes ? ` از ${faBytes(s.plan_bytes)}` : ""}
        </span>
        <span className="text-text-muted">{faNum(s.file_count)} فایل</span>
      </div>
      {s.plan_bytes ? (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={usagePercent(s)} aria-valuemin={0} aria-valuemax={100} aria-label="فضای پرشده">
          <div className="h-full rounded-full" style={{ width: `${usagePercent(s)}%`, background: TONE_COLOR[tone] }} />
        </div>
      ) : null}
      {tone === "over" && (
        <p className="text-xs" style={{ color: "var(--warn)" }}>
          {s.at_limit === "keep" ? "از اندازهٔ طرح گذشته؛ آپلود ادامه دارد و هزینهٔ اضافه با شماست." : "پر است؛ فایل‌های تازه به فضای سرریز می‌روند."}
        </p>
      )}
    </div>
    <p className="text-xs text-text-faint">
      {s.last_check_at ? `آخرین بررسی: ${faJalaliDateTime(s.last_check_at)}` : "هنوز بررسی نشده"}
      {s.last_check_error ? <span className="block text-crit">{s.last_check_error}</span> : null}
    </p>
    {s.state === "active" && (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-[44px]" onPress={onEdit}>
          <Icon name="edit" size="sm" />
          ویرایش یا عوض کردن کلید
        </Button>
        <Button variant="ghost" className="min-h-[44px]" onPress={onRemove}>
          <Icon name="trash" size="sm" />
          حذف این فضا
        </Button>
      </div>
    )}
  </section>
  );
}

/** A running or finished move (decision 9): progress, then keep or delete the old copies. */
function MoveCard({ m, fromName, toName, onClose }: { m: MoveRow; fromName: string; toName: string; onClose: (deleteOld: boolean) => void }) {
  return (
  <section className="card flex flex-col gap-2 p-[var(--space-4)]">
    <h2 className="sechead__title flex items-center gap-2">
      <Icon name="repeat" size="md" />
      انتقال از «{fromName}» به «{toName}»
    </h2>
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={m.total ? Math.round((m.done / m.total) * 100) : 100} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت انتقال">
      <div className="h-full rounded-full bg-accent" style={{ width: `${m.total ? Math.round(((m.done + m.failed) / m.total) * 100) : 100}%` }} />
    </div>
    <p className="text-sm text-text-muted">
      {faNum(m.done)} از {faNum(m.total)} فایل{m.failed ? `، ${faNum(m.failed)} فایل منتقل نشد` : ""}
    </p>
    {m.state === "finished" && m.from_storage_id != null && (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="min-h-[44px]" onPress={() => onClose(true)}>
          <Icon name="x" size="sm" />
          پاک کردن نسخه‌های فضای قبلی
        </Button>
        <Button variant="secondary" className="min-h-[44px]" onPress={() => onClose(false)}>
          <Icon name="archive" size="sm" />
          نگه داشتن در فضای قبلی
        </Button>
      </div>
    )}
  </section>
  );
}

/** Default storage, a storage per kind, and a mirror per rule (decision 3). */
function RulesCard({ data, onSave }: { data: Data; onSave: (rules: RuleRow[], move: boolean) => Promise<string | null> }) {
  const active = data.storages.filter((s) => s.state === "active");
  const initial = Object.fromEntries(data.rules.map((r) => [r.file_kind, r])) as Record<string, RuleRow | undefined>;
  const [rules, setRules] = useState<Record<string, RuleRow | undefined>>(initial);
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);
  const def = rules["*"];
  const defaultChanged = def?.storage_id !== initial["*"]?.storage_id;
  const changed = JSON.stringify(rules) !== JSON.stringify(initial);
  const options = active.map((s) => ({ id: s.id, label: s.name }));

  const set = (kind: string, patch: Partial<RuleRow> | null) =>
    setRules((r) => ({ ...r, [kind]: patch === null ? undefined : ({ file_kind: kind, storage_id: def?.storage_id ?? active[0]?.id, mirror_storage_id: null, ...r[kind], ...patch } as RuleRow) }));

  return (
    <section className="card flex flex-col gap-3 p-[var(--space-4)]">
      <h2 className="sechead__title">هر فایل کجا برود</h2>
      <Choice label="پیش‌فرض (همهٔ فایل‌ها)" options={options} value={def?.storage_id ?? null} onChange={(id) => set("*", { storage_id: id, mirror_storage_id: def?.mirror_storage_id === id ? null : def?.mirror_storage_id ?? null })} />
      {active.length > 1 && (
        <Choice
          label="کپی پشتیبان همهٔ فایل‌ها"
          options={[{ id: 0, label: "بدون کپی" }, ...options.filter((o) => o.id !== def?.storage_id)]}
          value={def?.mirror_storage_id ?? 0}
          onChange={(id) => set("*", { mirror_storage_id: id || null })}
        />
      )}
      {active.length > 1 &&
        FILE_KINDS.map((kind: FileKind) => {
          const r = rules[kind];
          return (
            <details key={kind} className="rounded-md border border-border p-2" open={!!r}>
              <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
                <Icon name="folders" size="sm" />
                {FILE_KIND_LABEL[kind]}: {r ? data.storages.find((s) => s.id === r.storage_id)?.name : "مثل پیش‌فرض"}
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <Choice
                  label="فضا"
                  options={[{ id: 0, label: "مثل پیش‌فرض" }, ...options]}
                  value={r?.storage_id ?? 0}
                  onChange={(id) => set(kind, id ? { storage_id: id, mirror_storage_id: r?.mirror_storage_id === id ? null : r?.mirror_storage_id ?? null } : null)}
                />
                {r && (
                  <Choice
                    label="کپی پشتیبان"
                    options={[{ id: 0, label: "بدون کپی" }, ...options.filter((o) => o.id !== r.storage_id)]}
                    value={r.mirror_storage_id ?? 0}
                    onChange={(id) => set(kind, { mirror_storage_id: id || null })}
                  />
                )}
              </div>
            </details>
          );
        })}
      {defaultChanged && (
        <Choice
          label="فایل‌هایی که الان در فضای پیش‌فرض قبلی‌اند"
          options={[{ id: "move", label: "منتقل شوند (در پس‌زمینه)" }, { id: "stay", label: "همان‌جا بمانند" }]}
          value={move ? "move" : "stay"}
          onChange={(v) => setMove(v === "move")}
        />
      )}
      {changed && (
        <GoButton
          icon="save"
          isDisabled={busy || !def}
          onPress={async () => {
            setBusy(true);
            await onSave(Object.values(rules).filter((x): x is RuleRow => !!x), defaultChanged && move);
            setBusy(false);
          }}
        >
          ذخیرهٔ قاعده‌ها
        </GoButton>
      )}
    </section>
  );
}

/** Decision 18: a storage with files is removed only after they move somewhere else. */
function RemoveSheet({ storage, others, onClose, onRemove }: {
  storage: PublicStorage;
  others: PublicStorage[];
  onClose: () => void;
  onRemove: (to: number | null) => Promise<string | null>;
}) {
  const [to, setTo] = useState<number | null>(others[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const empty = storage.file_count === 0;
  return (
    <BottomSheet open onClose={onClose} title={`حذف «${storage.name}»`} closeLabel="بستن حذف فضا">
      <div className="flex flex-col gap-3">
        {empty ? (
          <p className="text-sm text-text-muted">این فضا فایلی ندارد و همین حالا حذف می‌شود. خود باکت در آروان دست نمی‌خورد.</p>
        ) : others.length === 0 ? (
          <p className="text-sm text-text-muted">این فضا {faNum(storage.file_count)} فایل دارد. اول یک فضای دیگر اضافه کنید تا فایل‌ها به آن منتقل شوند.</p>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              این فضا {faNum(storage.file_count)} فایل دارد. فایل‌ها در پس‌زمینه منتقل می‌شوند و وقتی به ۱۰۰٪ رسید، این فضا حذف می‌شود. از همین حالا فایل‌های تازه به فضای انتخابی می‌روند.
            </p>
            <Choice label="فایل‌ها به کجا بروند" options={others.map((s) => ({ id: s.id, label: s.name }))} value={to} onChange={setTo} />
          </>
        )}
        {(empty || others.length > 0) && (
          <GoButton
            icon="trash"
            isDisabled={busy || (!empty && !to)}
            onPress={async () => {
              setBusy(true);
              await onRemove(empty ? null : to);
              setBusy(false);
            }}
          >
            {empty ? "حذف این فضا" : "انتقال فایل‌ها و حذف"}
          </GoButton>
        )}
      </div>
    </BottomSheet>
  );
}
