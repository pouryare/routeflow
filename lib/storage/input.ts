/** Checks what the add/edit storage sheet sends (a trust boundary: every field is the browser's word). */

import { normalPrefix } from "./driver";
import { devStorageAllowed } from "./local";
import { ARVAN_PRESETS } from "./s3";
import type { StorageInput, StorageRow } from "@/lib/repo/storages";

const GB = 1024 ** 3;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max + 1) : "");

export type Parsed = { ok: true; input: StorageInput } | { ok: false; error: string };

/** `existing` is the row being edited: its secret is kept when no new one is typed. */
export function parseStorageInput(body: Record<string, unknown>, existing: StorageRow | null, others: StorageRow[]): Parsed {
  const name = str(body.name, 60);
  if (!name || name.length > 60) return { ok: false, error: "یک نام کوتاه برای این فضا بنویسید (تا ۶۰ حرف)" };

  const kind = existing?.kind ?? (body.kind === "local" ? "local" : "s3");
  if (kind === "local" && !devStorageAllowed()) return { ok: false, error: "دیسک سرور فقط در حالت توسعه در دسترس است" };

  let endpoint: string | null = null;
  let region: string | null = null;
  let bucket: string | null = null;
  let accessKey: string | null = null;
  let secret: string | null = null;
  if (kind === "s3") {
    const preset = ARVAN_PRESETS.find((p) => p.key === body.preset);
    endpoint = preset ? preset.endpoint : str(body.endpoint, 200);
    region = preset ? preset.region : str(body.region, 60) || "us-east-1";
    if (!endpoint) return { ok: false, error: "نشانی (endpoint) فضای ذخیره‌سازی را بنویسید" };
    bucket = str(body.bucket, 63).toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return { ok: false, error: "نام باکت نامعتبر است (حروف کوچک انگلیسی، عدد، نقطه و خط تیره)" };
    accessKey = str(body.access_key_id, 200);
    if (!accessKey || accessKey.length > 200) return { ok: false, error: "کلید دسترسی (Access key) را بنویسید" };
    const typed = str(body.secret, 200);
    if (typed.length > 200) return { ok: false, error: "کلید مخفی بیش از اندازه بلند است" };
    secret = typed || null;
    if (!secret && !existing?.secret_enc) return { ok: false, error: "کلید مخفی (Secret key) را بنویسید" };
  }

  const prefix = normalPrefix(body.path_prefix);
  if (prefix === null) return { ok: false, error: "پوشهٔ داخل باکت فقط حروف انگلیسی، عدد، - و / دارد" };

  let planBytes: number | null = null;
  if (body.plan_gb !== null && body.plan_gb !== undefined && body.plan_gb !== "") {
    const gb = Number(body.plan_gb);
    if (!Number.isFinite(gb) || gb <= 0 || gb > 1_000_000) return { ok: false, error: "اندازهٔ طرح را به گیگابایت بنویسید، مثل ۵" };
    planBytes = Math.round(gb * GB);
  }
  const warn = body.warn_percent === undefined ? 90 : Number(body.warn_percent);
  if (!Number.isInteger(warn) || warn < 1 || warn > 100) return { ok: false, error: "درصد هشدار باید عددی از ۱ تا ۱۰۰ باشد" };
  const atLimit = body.at_limit === "spill" ? "spill" : "keep";

  let overflow: number | null = null;
  if (body.overflow_storage_id !== null && body.overflow_storage_id !== undefined && body.overflow_storage_id !== "") {
    overflow = Number(body.overflow_storage_id);
    const target = others.find((s) => s.id === overflow && s.state === "active");
    if (!target || target.id === existing?.id) return { ok: false, error: "فضای سرریز باید یکی دیگر از فضاهای همین شرکت باشد" };
  }
  if (atLimit === "spill" && !overflow) return { ok: false, error: "برای «انتقال به فضای دیگر» یک فضای سرریز انتخاب کنید" };

  return {
    ok: true,
    input: {
      name, kind, endpoint, region, bucket, path_prefix: prefix, access_key_id: accessKey, secret,
      plan_bytes: planBytes, warn_percent: warn, at_limit: atLimit, overflow_storage_id: overflow,
    },
  };
}
