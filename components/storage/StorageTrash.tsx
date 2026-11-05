"use client";

import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { faJalaliDateTime } from "@/lib/jalali";
import { FILE_KIND_LABEL, type FileKind } from "@/lib/storage/driver";
import { faBytes } from "@/lib/storage/view";

interface TrashItem {
  id: number;
  stem: string;
  file_kind: FileKind;
  variants: string;
  bytes: number;
  deleted_at: string;
  deleted_by_name: string | null;
  restorable: boolean;
}

const DAY = 86_400_000;
const daysLeft = (deletedAt: string) => Math.max(0, 30 - Math.floor((Date.now() - Date.parse(deletedAt)) / DAY));

/** Mounted only while open, so each opening reloads the list.
 *  Files deleted in the last 30 days (decision 12): see each one, put a deleted photo back. */
export default function StorageTrash({ open, onClose, onRestored }: { open: boolean; onClose: () => void; onRestored: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/storages/trash");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setItems(json.files as TrashItem[]);
    else setError(friendlyError(json.error, "سطل زباله بارگذاری نشد"));
  }, []);
  useRunAfterMount(load);

  async function restore(id: number) {
    setBusy(id);
    const res = await fetch(`/api/storages/trash/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(friendlyError(json.error, "بازگردانده نشد"));
    setError(null);
    await load();
    onRestored();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="سطل زباله" closeLabel="بستن سطل زباله" expandable>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">فایل‌های پاک‌شده ۳۰ روز اینجا می‌مانند و بعد برای همیشه پاک می‌شوند.</p>
        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        {items === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-muted">سطل زباله خالی است.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-md border border-border p-2">
                {f.variants.split(",").includes("webp") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, per-owner preview; next/image would cache it
                  <img src={`/api/storages/trash/${f.id}`} alt="" className="size-14 shrink-0 rounded object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded bg-surface-2">
                    <Icon name="file" size="md" />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col text-sm">
                  <span>
                    {FILE_KIND_LABEL[f.file_kind]} · {faBytes(f.bytes)}
                  </span>
                  <span className="text-xs text-text-faint">
                    {faJalaliDateTime(f.deleted_at)}
                    {f.deleted_by_name ? ` · ${f.deleted_by_name}` : ""} · {daysLeft(f.deleted_at).toLocaleString("fa-IR")} روز مانده
                  </span>
                </div>
                {f.restorable && (
                  <Button variant="secondary" className="min-h-[44px] shrink-0" isDisabled={busy === f.id} onPress={() => restore(f.id)}>
                    <Icon name="undo" size="sm" />
                    بازگردانی
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
