# Company storages (S3): design

Status: **designed 2026-11-05, not built.** Every choice below was made by the owner, one question at a time, in the project thread "Design per-company Arvan S3 storage". Decision summary in [`docs/decisions.md`](decisions.md) 10.15.

This replaces part of the 2026-10-28 plan (one Arvan account for the whole installation, chosen by the super-admin). Company files now live in storages each company brings itself. Database backups (pgBackRest repo3) still go to the platform owner's own Arvan bucket, as decided on 2026-10-28.

## 1. The idea in one example

«پخش تهران» adds two storages on the «فضای ذخیره‌سازی» page:

| Storage | Where | Plan | At the limit |
|---|---|---|---|
| تهران اصلی | Arvan, Tehran, bucket `pakhsh-photos` | 5 GB | keep uploading, I pay extra |
| تبریز پشتیبان | Arvan, Tabriz, bucket `pakhsh-copy` | 500 GB | spill to another storage |

Rules: everything goes to «تهران اصلی» (default), receipts also get a mirror copy in «تبریز پشتیبان». A driver takes a delivery photo: the server writes `routeflow/photos/2026-11/k3f9x2.webp` to Tehran. A receipt is written to Tehran and copied to Tabriz. Nobody in the field sees any of this.

## 2. Decisions (owner, 2026-11-05)

| # | Question | Answer |
|---|---|---|
| 1 | Whose accounts hold a company's files | **Each company brings its own.** There is no platform default storage. |
| 2 | Which files | **All company files**: visit and customer photos, payment and expense receipts, avatars, future documents («مدارک»). Database backups stay on the platform owner's Arvan. |
| 3 | Several storages | **One default plus rules by file type, and any rule may name a mirror** storage for a second copy. |
| 4 | Who edits | **Company owner and platform owner**, each must re-enter the 2FA code to save. A saved secret key is never shown again (last 4 characters only). |
| 5 | Storage down during an upload | **Hold on the app server, retry, warn the owner after 1 hour.** The upload succeeds for the driver. |
| 6 | No storage yet | **Uploads blocked.** Photo and receipt buttons say storage is not set up and to ask the owner. |
| 7 | Checking settings | **Test on save** (write, read, delete a tiny file; refuse if any step fails or the bucket is public) **plus a daily check** that warns the owner. |
| 8 | Server cache | **7-day disk cache for every file type**, as planned on 2026-10-28. |
| 9 | Changing the default | **Move old files in the background with progress**; reads try new, then old; at the end the owner chooses whether to delete from the old storage. |
| 10 | Encryption | **None by the app.** Private bucket, plain images and PDFs the company can open in its Arvan panel. |
| 11 | Names in the bucket | **Folders by type and month, random file names**: `routeflow/photos/2026-11/k3f9x2.webp`. No customer names in paths. |
| 12 | Delete | **30-day trash.** Gone from the app at once, restorable by the owner, then removed from the bucket and its mirror. |
| 13 | Usage | **Size and file count per storage, plus a warning limit** the owner sets. |
| 14 | Providers | **Any S3-compatible endpoint, with an Arvan preset** (pick Tehran or Tabriz, paste keys). Liara, ParsPack, self-hosted MinIO or Garage by typing the endpoint. |
| 15 | "Several keys" | Means **several storages per company**. Each storage has **one active key with a safe swap** (add new, test, switch, remove old). |
| 16 | Total space | **Owner types the plan size**; the app counts used space itself. While building, test Arvan's panel API; if it returns the plan total, an optional Arvan panel key fills it in. |
| 17 | Storage full, no paying extra | **Spill to an overflow storage** the owner picks; without one, uploads are held and the owner is warned. |
| 18 | Remove a storage with files | **Only after moving its files** (background move, removed at 100%). An empty storage is removed at once. |
| 19 | Log and notices | **Every change, key swap, move and failed check is logged** (who, when). In-app notice to the company owner, and a platform-owner page listing every company's storage problems. |
| 20 | Dev, demo and tests | A **«دیسک سرور» storage type that exists only when a dev setting is on**. Seed companies and tests use it; production cannot pick it. |
| 21 | Extras | **Persian setup guide** in the add-storage sheet (how to make an Arvan bucket and key) and a **weekly spot-check** of 100 random files (and their mirror copies). |
| 22 | At the limit | **Per-storage choice**: «ادامه، هزینهٔ اضافه را می‌پردازم» (warning only, the default; shown as e.g. 6.1 of 5 GB in orange) or «انتقال به فضای دیگر» (spill). |
| 23 | S3 library | **`@aws-sdk/client-s3`** (Apache-2.0). Tests use a fake S3 client. |

## 3. Data model

All tables carry `organization_id` and sit under row-level security like every tenant table (`lib/database/tenantTables.ts`).

- **`storages`**: `id`, `organization_id`, `name`, `kind` (`s3` or `local` (dev only)), `endpoint`, `region`, `bucket`, `path_prefix` (default `routeflow/`), `access_key_id`, `secret_enc` (AES-256-GCM, key from `deriveKey("storage-secret")` in `lib/auth.ts`, the same way TOTP secrets are kept), `secret_last4`, `plan_bytes` (typed by the owner, nullable), `warn_percent` (default 90), `at_limit` (`keep` or `spill`, default `keep`), `overflow_storage_id`, `state` (`active`, `moving_out`, `removed`), `last_check_at`, `last_check_error`, `used_bytes`, `file_count`.
- **`storage_rules`**: `organization_id`, `file_kind` (`photo`, `receipt`, `avatar`, `document`, or `*` for the default), `storage_id`, `mirror_storage_id` (nullable). Exactly one `*` rule per company once it has a storage.
- **`stored_files`**: one row per stored object, replacing the bare `file_stem` on disk: `id`, `organization_id`, `file_kind`, `storage_id`, `object_key`, `bytes`, `content_type`, `mirror_storage_id`, `mirror_state` (`none`, `pending`, `done`, `failed`), `upload_state` (`stored`, `held` on server, `failed`), `deleted_at` (trash), `created_at`. Photos, receipts, avatars and documents point at a `stored_files.id`.
- **`storage_jobs`**: queued work: `upload` (a held file), `mirror`, `move` (one storage to another), `purge` (trash older than 30 days), with attempts, next try and last error.
- **`storage_events`**: the log: who, when, which storage, what (`added`, `edited`, `key_swapped`, `default_changed`, `check_failed`, `check_ok`, `near_full`, `spilled`, `move_started`, `move_done`, `removed`, `file_missing`).

## 4. How a file flows

**Upload.** The API route works out the file kind, finds the company's rule, and writes the object with the existing image pipeline output (`lib/imagePipeline.ts`). If the company has no storage, the route refuses with a Persian message and the button was already shown disabled (decision 6). If the storage is full and set to `spill`, it writes to the overflow storage and logs `spilled`. If the write fails (network, Arvan down), the file is saved under `data/held/` on the app server, `upload_state = held`, and an `upload` job retries with back-off; after 1 hour still held, the owner gets a notice (decision 5). If the rule has a mirror, a `mirror` job copies it after the main write.

**Read.** Unchanged entry point: `app/api/photos/[id]/file` and the receipt routes keep their company and role checks before any byte is read. Then: local 7-day cache, then the file's storage, then its mirror, then (during a move) the other storage. No signed or public links.

**Delete.** Sets `deleted_at`. The owner sees a «سطل زباله» list and can restore. A daily `purge` job deletes objects older than 30 days from the storage and the mirror and drops them from the cache.

**Move.** Changing the default (for existing files, decision 9) or removing a storage (decision 18) queues one `move` job per file. A progress bar shows done / total. New files go to the new storage at once. At 100% the owner is asked whether to delete the copies in the old storage; removing a storage happens only then.

## 5. Checks

- **On save** (and on key swap): put a 1-byte object under `routeflow/.check/`, read it back, delete it, and make an anonymous GET of the bucket URL that must be refused (a public bucket is rejected). Each failed step gives its own Persian reason (wrong key, bucket missing, clock skew, bucket is public, endpoint unreachable).
- **Daily**: the same test for every active storage, from a sweep (systemd timer through `scripts/run-sweeps.mjs`, like the rules and analysis sweeps). A failure logs `check_failed` and notifies.
- **Weekly spot-check**: 100 random `stored_files` per company, a HEAD on each copy; a missing one logs `file_missing` with the file's page link.
- **Usage**: `used_bytes` and `file_count` change on every write and delete; a weekly listing of the bucket under the prefix corrects drift. Over `warn_percent` of `plan_bytes` logs `near_full` once per crossing.

## 6. Screens

**Placement («محل در رابط کاربری»).** Roles: owner and platform owner. Nav group `org` in `lib/appNav.ts`, next to «کاربران» and «وضعیت سامانه»: new tab «فضای ذخیره‌سازی» at `/sales/admin/storage`, `ready: isOwner(r)` (platform owner included). Two taps from the bottom bar (menu, then the tab), within the budget in `docs/mobile-first-principles.md` section 5.

- **Storage list**: one card per storage: name, provider and city, a usage bar (3.2 of 5 GB, 8,410 files; orange past the limit), last check time with a green or red dot, and a «پیش‌فرض» chip. Primary action «افزودن فضا» in the thumb zone (`StickyAction`). Empty state explains that uploads are blocked until one storage is added, with the button.
- **Add or edit sheet** (`BottomSheet`): provider chips (Arvan Tehran, Arvan Tabriz, other S3), bucket, access key, secret key (password field, shows `••••AB12` after saving), plan size, warning percent, at-limit choice, overflow storage. The Persian setup guide sits in an accordion at the top. Save runs the test, then asks for the 2FA code.
- **Rules card**: «پیش‌فرض» plus one row per file kind that differs, each with an optional mirror.
- **Moves card**: progress bars of running moves.
- **Trash list**: deleted files of the last 30 days with «بازگردانی».
- **Log**: the company's `storage_events`, newest first.
- **Platform owner page**: one list of every company's storage problems (failed checks, held uploads, near full, missing files). Placed in the platform owner's existing admin area; exact spot decided when building, within the 2-tap budget.
- **Field phones**: when no storage exists, photo and receipt buttons are disabled with «فضای ذخیره‌سازی تنظیم نشده؛ به مالک شرکت بگویید».

Bencho blocks to consider when building (owner rule 2026-11-05): a count-up for the usage figure, an accordion for the setup guide. No block for the key fields.

## 7. Security

- Secrets encrypted at rest and never sent back to the browser; only `secret_last4`. Changing `SESSION_SECRET` makes stored keys unreadable, so the runbook must say to re-enter them (same as TOTP secrets today).
- Saving needs the owner or platform owner role **and** a fresh 2FA code, checked on the server.
- The endpoint is typed by the company, so the server fetches a URL a user chose (SSRF). Refuse private, loopback and link-local addresses and non-HTTPS endpoints in production, after DNS resolution; the dev `local` kind is the only way to reach the server itself.
- Every read still goes through the company and role check before the storage is touched; `404` for files of another company.
- Object keys are random; nothing personal in paths.
- Uploads keep the existing magic-byte checks and re-encoding.

## 8. Build order (when the owner says go)

One commit each, one draft PR, per the batch rule:

1. Add `@aws-sdk/client-s3` (with `requestChecksumCalculation: "WHEN_REQUIRED"`, since newer SDK checksums are rejected by some S3-compatible services) and a `lib/storage/` layer with two drivers, `s3` and `local`, behind one interface (put, get, head, delete, list). Fake S3 in tests.
2. Migration: the five tables, RLS, and a backfill that registers the existing demo files under a `local` storage per seed company.
3. Route uploads and reads through the layer: photos, payment and expense receipts, avatars. Held uploads and the `upload` job.
4. Storage page: list, add/edit sheet with test on save and 2FA, rules, setup guide.
5. Mirror, spill, usage counters and warnings.
6. Moves, removal after a move, trash and purge.
7. Daily check, weekly spot-check and usage correction sweeps; notices; log; platform owner page.
8. Test Arvan's panel API with a real account; if it returns the plan total, the optional panel key.

## 9. Not in this design

Per-company data exports into the company bucket (offered, not chosen). App-side encryption (decision 10). Signed or public links. Splitting write and read keys. Pools of keys used in turn. Google Drive.

## 10. Risks the owner should know

- With no platform default, a company that never adds a storage cannot take a single photo (decision 6).
- Files on the server cache and in held uploads sit on the platform owner's disk for up to 7 days, including receipts (decision 8).
- Arvan details (panel API, plan total, behaviour when a free plan is full) are unverified until tested with a real account.
