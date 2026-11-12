# Releasing and running RouteFlow on a server

How a version gets from a git tag to the server, and the one command that runs the server. The database
side (PostgreSQL, roles, pgBackRest) is in `docs/postgres-server.md`; this page is everything around it.

Decided 2026-11-04/05 (plan: `plans/release-0.1-plan-2026-11-04.md` in the project files): systemd, no
Docker; versions are minor per feature release and patch per fix, 1.0 once real users depend on it;
Ubuntu 26.04 on a 4 GB / 2 CPU / 80 GB Arvan VPS behind Arvan CDN; off-site backups on the home Pi.

## The flow, end to end

1. Set the version in `package.json` (for example `0.1.0`), merge to `main`.
2. Tag it: `v0.1.0`. Cloud sessions cannot push tags, so the owner tags on the GitHub website
   (Releases, "Draft a new release", new tag `v0.1.0` on `main`).
3. `.github/workflows/release.yml` checks that the tag matches `package.json` and that every migration is
   marked (below), builds once, packs `routeflow-0.1.0-linux-x64.tar.gz` and `-linux-arm64.tar.gz`
   (`scripts/release/pack.sh`), starts the x64 one to check `/api/health` answers with its version, and
   publishes both with their `.sha256` on the GitHub release.
4. The `deploy` job copies the tarball for the server's machine type into `/opt/routeflow/incoming/`
   over SSH. The `.sha256` goes last, so a half-copied tarball is never picked up.
5. At 03:30 Tehran (00:00 UTC; `UPGRADE_AT` in `/etc/routeflow/routeflow.conf`) the server runs
   `routeflow upgrade-scheduled`: the newest waiting version is upgraded to (below). To apply it when you choose:
   `sudo routeflow update`: it finds the waiting file, asks "upgrade now?" (default: no, tonight) and does what you answer.
   No SSH deploy secrets (`DEPLOY_*`)? Then the `deploy` job only publishes, and `incoming/` stays empty.
   Use `sudo routeflow update` on the server instead: it downloads the newest release from GitHub (asking for
   a read-only token, never saved), checks the sum, and asks whether to upgrade now or leave it for tonight.

"Run workflow" on the Release action builds the same tarballs without a tag and keeps them for 7 days, to
try a build first.

Each tarball carries its own Node, the right `sharp` build for its machine, the migrations and the
migration runner, and the server scripts. The server needs no Node from apt and downloads nothing during an
upgrade. Lead import (Playwright) still needs a Chromium on the server; it is not shipped.

## The routeflow command

On the server, `sudo routeflow` with no arguments opens a menu (Whiptail). The menu calls the same
commands:

| Command | What it does |
|---|---|
| `routeflow install [--yes] [tarball]` | Fresh Ubuntu or Debian server: asks for the domain, the backup machine, the company name and the first login's username (with `--yes`, nothing is asked), then packages, firewall (SSH, 80, 443), Tehran time zone, security updates with a reboot only at 02:30, a log cap, PostgreSQL and backups (`db/server/install.sh`), the database connection (a web role and its password, written into the encrypted secrets), the app service, Caddy, the nightly upgrade timer, the rules timer (every 5 minutes: callback and follow-up tasks, escalation, push and Telegram flush; an existing server gets it by running `routeflow install` again), the first release, the company name and the first login. Run again to re-apply after editing `routeflow.conf`. |
| `routeflow upgrade <tarball>` | Checks the sum and machine type, unpacks to `releases/<version>`, takes a backup, runs the migrations, switches `current`, waits for `/api/health` with the new version, then the smoke check. |
| `routeflow update` | The one command for a new release. Uses the file GitHub already copied into `incoming/`; with none waiting it downloads the newest from GitHub (read-only token, never saved) and checks the sum. When the live release has the same Node and libraries (the `BASE_ID` file), only the small `.app.tar.gz` (about 10 MB, not 90) is downloaded and the full tarball is put together from the live copy; otherwise the whole release. A big file is fetched in 8 pieces side by side (`DOWNLOAD_SEGMENTS`, 1 turns it off); a piece that drops carries on from the bytes it has (12 tries), and running the command again continues what arrived. Then asks: upgrade now, or tonight (the default). |
| `routeflow upgrade-scheduled` | What the 03:30 timer runs, with no question: the newest tarball in `incoming/` not yet installed. Not for people; use `update`. |
| `routeflow rollback` | Back to the previous release (the last 3 are kept). |
| `routeflow status` | Live release, service, health, disk, last backup, database check. |
| `routeflow backup [full\|diff\|incr]`, `restore-drill`, `restore <1\|2>` | Backups; `restore` replaces the database and asks you to type RESTORE. |
| `routeflow secrets list \| set KEY \| unset KEY \| backup \| restore <file>` | The encrypted secrets (below). |
| `routeflow logs` | The last 100 app log lines and Caddy warnings. |

Night order on the server (Tehran): 01:30 backup, 02:30 OS reboot if an update needs one, 03:30 app
upgrade, 04:00 on the 1st the restore drill.

### When an upgrade fails its checks

Every migration says in its header whether the previous release can still run after it:

- `-- rf: expand-only`: it only adds (a table, a nullable or defaulted column, a plain index). After a
  failed upgrade `routeflow upgrade` switches back to the previous release by itself.
- `-- rf: contract`: it changes or removes something the previous release uses. A failed upgrade stops,
  leaves the new release live, and asks a person (`routeflow logs`, then fix forward or restore).

`node scripts/check-migrations.mjs` (run in CI and before each release) fails on a migration with no
marker, or one marked expand-only that drops, renames, changes a type, adds a constraint or a unique index
to an existing table, changes rows, or adds a required column with no default.

The smoke check after each upgrade renders `/login`, loads a script it links, and, when `SMOKE_USER` is in
`routeflow.conf` and `SMOKE_PASSWORD` in the secrets, signs in and opens `/api/me` and `/api/customers`.
Make that user a read-only manager kept only for this.

## Secrets

`DATABASE_URL`, `SESSION_SECRET` and any key ending in `_TOKEN`, `_PASSWORD`, `_PASS`, `_SECRET`, `_KEY`
or `_APIKEY` live in `/etc/routeflow/secrets.cred`, encrypted with `systemd-creds` (this machine's key, and
its TPM when it has one). systemd decrypts it only into the private folder of the app and backup services.
`/etc/routeflow/env` keeps the plain settings. `routeflow install` moves any secret it finds in `env` into
the encrypted file.

- Add or change one: `sudo routeflow secrets set TELEGRAM_BOT_TOKEN` (the value is asked, never typed on
  the command line). The app restarts.
- **Keep a copy off the server.** The encryption key dies with the machine, so after the first install
  and after every change run `sudo routeflow secrets backup`, choose a passphrase you keep in a password
  manager, and put the `.env.asc` file in the private repo (`routeflow-private`). Never in this repo.
- Rebuilding on a new server: copy the `.env.asc` there, `sudo routeflow secrets restore <file>`, then
  `sudo routeflow install <tarball>`. Sessions survive (same `SESSION_SECRET`) and the database role keeps
  its password.

This guards against a secret leaking through a copy of `/etc`, a screenshot or a pasted file. It does not
guard against someone who is root on the running server.

## A fresh server: answer the questions

Copy the tarball for the server's machine type (from a GitHub release or a manual Release run) to the
server, unpack the command and run it with no arguments:

```sh
tar -xzf routeflow-0.1.0-linux-x64.tar.gz
sudo bash routeflow-0.1.0-linux-x64/bin/routeflow install
```

It asks, one question at a time, with an example and a default in `[brackets]` (Enter keeps it): the
address, the company name, the first login's username and password (Enter = a random one), which
certificate to use toward Arvan, whether the web ports are for Arvan only, whether to send backups to the
Pi (and its address, user and folder), and an optional GitHub public key. It ends with a summary and
"Start the install now?". If the release file is not in the current folder, it asks where it is. Your
answers are saved in `/etc/routeflow/routeflow.conf` (the password is not), so running it again offers
them as the defaults.

What it does around the questions (all in `deploy/routeflow`):

- **One command.** Put `install.sh`, the tarball and its `.sha256` (all three are in the release, or in the
  zip of a manual Release run) in one folder on the server and run `sudo bash install.sh`. It checks the
  checksum first, then unpacks and starts the questions.
  **Only `install.sh` is needed on the server:** with no tarball next to it, it downloads the newest GitHub
  release for this machine itself. A private repo needs a read-only token (fine-grained, this repo only,
  Contents: read), asked once with nothing shown as you type, never saved; Enter tries without. If the download
  fails it prints the release page and the `scp` command, then waits until both files are in the folder and
  continues by itself. It needs a published release (a tag), not a manual workflow run.
- **Answers are checked as typed** (domain, username, SSH key, Pi address; the Pi must answer on port 22
  or you confirm). At the summary, type a number to change that answer.
- **A pause for the Arvan panel**: the A record with the cloud ON and the SSL mode, before it starts.
- **Arvan API key (question 9, optional).** With a key the installer makes that A record itself (this server's
  public IP, cloud on, Arvan's managed HTTPS on; the domain, e.g. `routeflows.ir`, must already be in your Arvan
  account), so only the SSL-mode step stays by hand. The key is kept in the encrypted secrets as `ARVAN_API_KEY`
  (the same key the «شرکت‌ها» page uses). With `--yes`, set `ARVAN_API_KEY` in the environment. Not run against
  the real Arvan yet; if Arvan refuses, the installer prints Arvan's message and falls back to the by-hand step.
- **`sudo routeflow arvan-probe [domain]`** (read-only): asks Arvan which parts of its CDN API the saved key can reach
  for the main domain (settings, WAF, firewall, page rules, cache and more: path, answer code, setting names; keys and
  tokens are never printed) and saves the report in `/etc/routeflow/arvan-probe.txt`. Paste it to whoever builds the
  next Arvan feature, e.g. the rule that lets photo uploads (`/api/photos`, `/api/photos/avatar`) past Arvan's
  512 KB WAF body limit, so no endpoint is guessed.
  **First real report (owner's server, 2026-11-11, free plan):** the key reads domains, DNS records, `ssl`, `caching`,
  `firewall/rules`, `page-rules`, `load-balancers`, `acceleration`, `custom-pages` and `ssl/certificates` (200). These
  paths do not exist (404), so do not call them: `waf`, `waf/exceptions`, `waf/whitelist`, `firewall`, `ddos`,
  `rate-limit`, `https`, `upload-limit`, `security`, `settings`, `cname-setup`, `analytics`, `logs`. Arvan's managed
  HTTPS was on after the install (an active Let's Encrypt `*.routeflows.ir` certificate). A rule made by hand in the panel
  (Firewall settings, "Allow" when URI Path starts with `/api/photos`) reads back at `GET /domains/<domain>/firewall/rules`
  as `{id, name, filter_expr: '((http.request.uri.path starts_with "/api/photos"))', action: "allow", action_details: {},
  is_enabled: true, priority: 1, note: "", is_account_level: false}`. **A rule name with a hyphen is refused** ("title
  contains illegal characters"); letters only (`routeflowphototest`) were accepted. The create call (POST to the same path)
  has not met the real Arvan yet. The installer (`routeflow install`, after the A record) and the app (when a company address
  is added, `lib/arvan.ts`) now make one rule, `routeflowphotos`, for `/api/photos` (covers `/api/photos/avatar`), unless a rule for
  that path exists; a refusal prints Arvan's message and the by-hand steps, and never stops the install.
- **It runs in the background** (a systemd unit). Closing the window or losing the connection does not stop
  it; `sudo tail -f /var/log/routeflow-install.log` shows it again. The first login is kept in a root-only
  file and shown by `sudo routeflow first-login` (once). If you lose it: `sudo routeflow reset-login <user>`.
- **A progress bar**: `[████░░░░░░] 4/11 Firewall`, the time each step took, and at the end a green/red
  final check (app, address, HTTPS through Arvan, backup, Pi) with what to do about each red line, then the
  next steps in order and a QR code for the address.
- **Run it again safely.** A re-run first copies the settings to `/var/backups/routeflow-config-*.tar.gz`
  (put back with `sudo tar -xzf <file> -C /`) and, when the app is already live, takes a backup. Only the
  package download is skipped the second time (`ROUTEFLOW_FRESH=1` repeats it). It is not an automatic undo.
- `sudo routeflow install --check` asks the questions and runs only the checks, then lists what a real run
  would do. Nothing changes.
- `sudo routeflow support-file` makes one file with the doctor output, logs and settings, passwords and
  tokens hidden, to send for help. `sudo routeflow uninstall` removes the app, services and Caddy site and
  keeps the database, backups, photos and secrets.
- **After the install:** `sudo routeflow install-report` repeats only the final check (after a fix in the
  Arvan panel). `sudo routeflow check-pi` says which part of the Pi link fails (network, key, host key,
  folder) and prints the commands to paste. `sudo routeflow cdn-ips --open` opens ports 80/443 to everyone
  when Arvan-only locks you out (`--only` goes back). The progress line guesses the time left from usual
  step lengths (an estimate; re-weighed after the first real run), and the terminal title shows installing,
  done or FAILED.
- After an upgrade, the line `0.2.0 is live (was 0.1.0). Migrations applied: N (names)`.

For a script, skip the questions with `--yes` and pass the answers as variables:

```sh
sudo DOMAIN=app.example.ir COMPANY_NAME="پخش نمونه" \
  DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-deploy" \
  bash routeflow-0.1.0-linux-x64/bin/routeflow install --yes routeflow-0.1.0-linux-x64.tar.gz
```

(`tar -xzf <tarball> --wildcards '*/bin/routeflow'` takes the command out of the tarball first.) Only
`DOMAIN` is required; `OFFSITE_HOST`, `OFFSITE_USER`, `OFFSITE_PATH`, `OWNER_USER` (default `admin`),
`OWNER_PASSWORD` (default: a random one) and `DEPLOY_PUBKEY` are optional. At the end it prints the
address and the first login, a platform owner, with its password **once**: sign in and change it. A
second run never makes a second login.

Before it changes anything it checks the machine: Ubuntu or Debian, at least 1.5 GB of memory and
10 GB free, nothing else on ports 80 and 443, and that `DOMAIN` resolves. It stops with the list of
problems instead of failing halfway. Along the way it adds 2 GB of swap when there is none and tunes
the kernel's network settings (below). SSH is left as the VPS came (owner's choice, 2026-11-06). Everything it prints is also in `/var/log/routeflow-install.log`, except the first login's password.
At the end it makes a full backup and restores it into a scratch copy, so backups are proven on day one.

When `OFFSITE_HOST` (the Pi) does not take the backup key yet, the install goes on with backups on this
server only and prints the commands to paste on the Pi (the backup user, folder and key, then the
monitor, which ships in the tarball as `bin/routeflow-monitor`). Paste them, run
`sudo routeflow install --yes` again, and backups go to the Pi too. On the Pi, `routeflow-monitor test`
proves Telegram and SMS reach you.

What it connects on its own: PostgreSQL with the app's own login role, its password inside
`DATABASE_URL` in the encrypted secrets, a new `SESSION_SECRET`, the migrations, backups, Caddy with its
certificate, and the nightly upgrade. What it cannot do for you: point the domain at the server in the
Arvan panel, and make the off-site machine accept the backup user's key.

**One Caddy file per site.** `/etc/caddy/Caddyfile` holds only global options and one line,
`import sites/*.caddy`. RouteFlow writes `/etc/caddy/sites/routeflow.caddy`. To host another site on the
same server, add `/etc/caddy/sites/othersite.caddy` with its own `othersite.example.com { ... }` block, run
`caddy validate --config /etc/caddy/Caddyfile`, then `systemctl reload caddy`. Re-running
`routeflow install` rewrites only `routeflow.caddy`, never the other files. An older install that imported
`/etc/caddy/routeflow.caddy` is moved to the new layout on the next install.

## Company addresses

Each company can have its own web address (`app.tamino.ir`). The platform owner adds it in the app, on
«شرکت‌ها» (`/sales/admin/companies`); nothing is edited on the server by hand.

- **What the server does.** `routeflow install` writes a second file, `/etc/caddy/sites/routeflow-companies.caddy`,
  that accepts any address and passes it to the app, and adds `on_demand_tls { ask ... }` to the Caddyfile's
  global block. Before Caddy makes a certificate for a name it has not seen, it asks the app
  (`/api/domains/ask`); the app says yes only for an address a company has registered. The app also gets
  `MAIN_HOST=<your domain>`, so an address that is neither the main one nor registered is refused at sign-in.
  Run `routeflow install` again on an existing server to get both files.
- **Arvan does the certificate.** Caddy's file for them always uses its own internal
  certificate, so Arvan must be set not to verify the origin's certificate, as for the main address.
- **Free plan (owner decision 2026-11-11).** Arvan's CNAME setup is Enterprise-plan only, so it is not used. A
  customer's domain (e.g. `taminodis.ir`) is added to your Arvan account as a full domain and the customer moves
  its nameservers to the ones Arvan gives. The customer then no longer controls that domain's DNS records.
- **Steps** (the page lists them). (1) Once per domain: add it in your Arvan panel, give the customer the nameservers.
  (2) In Arvan DNS add an A record for the address (e.g. `app`) to the server, cloud on. (3) In the Arvan HTTPS section
  get the free certificate. (4) Press «بررسی دوباره» on «شرکت‌ها». The page has no field for an Arvan CNAME value
  (it was removed: the free plan never uses it).
- **Status.** «بررسی دوباره» reports: waiting for DNS (the address does not reach the app yet: nameservers not moved or
  the A record missing), or active (the address answers `/api/health` with this app's answer).
- **Arvan API (built, not yet tried against the real panel).** Put a key with CDN permission on the server with
  `sudo routeflow secrets set ARVAN_API_KEY` (the value is asked, never typed on the command line), and restart the
  app. The page then does the Arvan steps itself when an address is added («تنظیم در آروان» retries them): adds the
  customer's domain (full mode), makes the `app` A record to the server with the cloud on, turns HTTPS on, and shows
  the two nameservers for the customer in the status line. The server's public IP is set in the «آروان و آدرس سرور»
  section (or `SERVER_IP`); «تغییر IP سرور» moves every company address's A record to a new VPS in one go, and
  «خالی کردن حافظهٔ موقت» empties Arvan's cache for all company domains. Without the key the page shows the manual steps.
  Paths and field names come from client libraries, not Arvan's reference, so the first real run may show a message
  from Arvan that needs a small fix in `lib/arvan.ts`. Not built: certificate expiry warnings, firewall rules,
  under-attack mode, path rules for `/api/live`.
- **Closing the main address.** Until every company has an active address, leave the main address open. Then
  «فقط مدیر سامانه» on the same page makes it platform-owner only. A company with no active address cannot
  sign in once it is closed.
- Caddy 2.6 (Ubuntu's package) validated both files; the certificate flow was tried locally (see the pull request).

## Running from inside Iran

`routeflow install` also sets up the following (owner's pick, 2026-11-06). Each one can be changed in
`/etc/routeflow/routeflow.conf` and applied by running the install again.

- **Package mirror inside Iran** (`APT_MIRROR`, default `https://mirror.arvancloud.ir`, `off` to skip).
  Ubuntu's own packages and security updates come from Arvan's mirror, so they keep working when
  international internet is cut. The switch happens only if the mirror answers and `apt-get update`
  succeeds; otherwise the old lists come back (`*.before-routeflow`). PostgreSQL (PGDG) and Caddy still
  come from their own foreign repositories.
- **Clock from Iranian time servers** (`NTP_SERVERS`, default `ir.pool.ntp.org`, then ntp.ubuntu.com). The
  two-step sign-in codes stop matching when the clock is off by a minute.
- **Web ports for Arvan only** (`CDN_ONLY=1`). Ports 80 and 443 accept only Arvan's address ranges, read
  from `https://www.arvancloud.ir/en/ips.txt`. A weekly timer (Sunday 05:00) refreshes them with
  `routeflow cdn-ips`, which adds new ranges before it removes old ones. If the list cannot be read, the
  rules stay as they were. Set `CDN_ONLY=0` to open the ports to everyone, for example while testing
  without the CDN.
- **Certificate toward Arvan** (`CERT_MODE`):
  - Default: Let's Encrypt through Arvan. It works as long as Arvan passes plain HTTP for
    `/.well-known/acme-challenge/` to this server.
  - Arvan origin certificate: put it at `/etc/routeflow/tls/origin.crt` and `origin.key` and it is used
    instead.
  - `CERT_MODE=internal`: Caddy's own certificate, with Arvan set not to check the origin's certificate.
  - None of the three has been tried against Arvan yet.
- **Live updates through Arvan** (issue #58). `/api/live` is one long response that the app writes to as
  things happen (server-sent events). Caddy leaves it uncompressed and sends each piece at once. In the
  Arvan panel, add a rule for the path `/api/live`: no caching, no compression, and the longest idle
  timeout allowed; the app writes a small heartbeat every 20 seconds, so any timeout over that is
  enough. To check it from a laptop: `curl -N -H 'Cookie: …' https://DOMAIN/api/live` should print `: ok`
  at once and `: hb` every 20 seconds, not everything in one lump. Arvan's setting names are not
  verified yet. `curl https://DOMAIN/api/health` shows `live.listening` and the open streams.
- **`routeflow doctor`**: runs the pre-install checks again, plus the clock, the firewall ranges, the
  certificate's expiry date and `routeflow status`.
- **Status on login**: every SSH login shows one line with the version, health, age of the last backup and
  disk use (`routeflow status-short`).

## More safety (owner's pick G to L, 2026-11-06)

- **Rebuild on a new server.**
  - `routeflow secrets backup` now writes one encrypted bundle. It holds the secrets,
    `routeflow.conf`, the pgBackRest passphrase (without it the backups cannot be read) and the backup SSH
    key, so the Pi accepts the new server.
  - On a fresh VPS, run `sudo routeflow rebuild routeflow-secrets-....tar.asc [tarball]`. It restores
    that bundle, installs everything, loads the newest database from the Pi, runs any newer migrations
    and checks pgBackRest. Your usual logins work again, because the users come back with the database.
  - Not tried end to end yet.
- **Page during upgrades.** While the app restarts, Caddy answers with a short Persian «در حال
  به‌روزرسانی» page that reloads itself every 15 seconds, and `/api/*` gets
  `{"ok":false,"maintenance":true}`. Both use status 503 and `Cache-Control: no-store`, so Arvan never
  keeps the page. Tried with Caddy 2.6.
- **PostgreSQL memory sized to the server.** `install.sh` writes `zz-routeflow-memory.conf`:
  - `shared_buffers` 25% of memory and `effective_cache_size` 75%;
  - `maintenance_work_mem` memory/16, at most 1 GB;
  - `work_mem` memory/256, between 4 and 64 MB.

  On 4 GB that is 1 GB, 3 GB, 256 MB and 16 MB. The fixed values in `postgresql.routeflow.conf` were for
  16 GB (4 GB of `shared_buffers` would fill a 4 GB server). Run the install again after resizing.
- **Disk check before every upgrade.** With less than 3 GB free on `/opt/routeflow` (`MIN_FREE_GB`),
  the upgrade stops before it changes anything.
- **Certificate alert.** The Pi monitor reads the expiry date of the certificate users see once a day.
  It warns on Telegram from 14 days before.
- **Helper access that expires.** `routeflow support-key add "ssh-ed25519 AAAA... name" 3d` (or `12h`)
  adds the key for root with OpenSSH's own `expiry-time`, so sshd refuses it after that time even if
  nothing else runs. An hourly timer then deletes the line. `routeflow support-key list` and `remove`
  show and end access early.

## Sending the database for a change, and taking a fix back

- `sudo routeflow export` writes `/var/lib/routeflow/exports/routeflow-<date>.dump` (pg_dump custom
  format, every company, with grants). It holds personal data, so send it only through a private
  channel.
- The usual way back is a fix, not a whole database: a reviewed `fix.sql`, applied with
  `sudo routeflow sql fix.sql`. It shows the SQL, asks you to type APPLY, takes a backup, and runs the
  file in one transaction, so any error leaves nothing changed. Orders entered between the export and
  the fix are kept, which re-importing a changed dump would lose.
- When a whole database has to go back: `sudo routeflow import <file.dump>`.
  - It asks you to type IMPORT and takes a backup.
  - It stops the app and renames the live database to `routeflow_before_import_<time>`. It is kept,
    not dropped.
  - It restores the file, runs the migrations and starts the app.
  - If the restore fails, the old database is put back.
- On the development side, the file loads into a local database with `pg_restore -d <db> <file>`.

## Everyday extras (owner's pick M to Q, 2026-11-06)

- **Upgrade preview.** `sudo routeflow upgrade --check <tarball>` changes nothing. It shows the version
  jump, the free disk space, every database change with its marker, and whether a failed upgrade would
  switch back by itself.
- **Maintenance switch.** `sudo routeflow maintenance on` makes Caddy show the «در حال به‌روزرسانی» page
  (503, never cached) to everyone, with no reload, because it only checks for
  `/etc/routeflow/maintenance.on`. `off` opens the app again, and `status` says which.
- **Anonymous export.** `sudo routeflow export --anonymise` dumps the live database into a scratch copy
  and changes the details there. The live database is never touched.
  - Phones become `09…` numbers.
  - Names, shop names, addresses and notes become «نمونه xxxxxx», and emails `u…@example.com`.
  - Two-step secrets and recovery codes are removed.
  - The same input always gives the same fake value, so duplicates still show.
  - Map points, amounts and dates stay real.
  - Columns are chosen by name, so a new personal column needs its name added in `anonymise_sql`.
  - Tried on the demo data: 500 customers, all phones replaced with valid `09` numbers.
- **Login rescue.** `sudo routeflow reset-login <username>` sets a new random password (printed once),
  turns off two-step sign-in, signs out every session and reactivates the account
  (`scripts/reset-login.mjs`).
- **Export tidy-up.** Exports older than 7 days (`EXPORT_KEEP_DAYS`) are deleted by the hourly
  `routeflow tidy`. `routeflow export --encrypt` locks the file with a passphrase (`.dump.gpg`), and
  `routeflow import` opens such a file.

## Kernel settings

`/etc/sysctl.d/60-routeflow.conf` (written by `routeflow install`, from `write_sysctl` in
`deploy/routeflow`). It started from a common "speed" list. These parts are kept or changed:

- **Kept:** BBR with `fq` (the biggest win on lossy, long links), larger socket buffers (16 MB),
  shorter FIN and keepalive times, SYN cookies, `tcp_tw_reuse`.
- **Smaller:** `somaxconn` 4096 and `tcp_max_syn_backlog` 8192 instead of 32768/16384. One small server
  behind a CDN never queues that many, and Node's own backlog is 511.
- **Changed:** outgoing ports start at 10240, not 1024. From 1024 the kernel could hand out 3003 or 5432
  as a client port and block the app or PostgreSQL from starting.
- **Added:** `tcp_mtu_probing` (paths that drop large packets), `tcp_slow_start_after_idle = 0` (CDN
  connections stay fast), no ICMP redirects, `rp_filter`, reboot 10 s after a kernel panic, and
  `LimitNOFILE=65536` on the app service.
- **Left out on purpose:**
  - `tcp_timestamps = 0`: `tcp_tw_reuse` needs timestamps, and they guard against old packets.
  - `tcp_syn_retries = 1` and `tcp_synack_retries = 1`: on a lossy link, one lost packet would fail the
    connection to the Pi or a slow phone.
  - `tcp_max_tw_buckets = 6000`: it makes the kernel drop closing connections under load.
  - `fs.file-max`: already in the millions on current kernels. The per-service limit above is what counts.
  - The `inotify` limits: they matter for file watchers in development, not for a server.
  - `tcp_max_orphans`, `route.gc_timeout`, the UDP minimums, and the IPv6 and ICMP lines: they are
    already the defaults, or they do nothing for this server.

## Setting up the GitHub deploy

Easiest: `sudo routeflow github-deploy` (also step 5 of the install's "Next" list). It makes the `deploy` user and a
new key pair, then shows the four GitHub secrets one at a time (`DEPLOY_SSH_KEY`, `DEPLOY_USER`, `DEPLOY_HOST`,
`DEPLOY_KNOWN_HOSTS`), waiting for Enter after each; only pasting them into GitHub is by hand. The secret key
is shown on the terminal only and is deleted when the command ends. Run it again to replace the key.

By hand, instead:

With `DEPLOY_PUBKEY` set, the install makes the `deploy` user with that key. By hand instead:

```sh
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# paste the public half of a new key made for GitHub only:
sudo tee /home/deploy/.ssh/authorized_keys >/dev/null
sudo routeflow install --yes          # adds deploy to the routeflow group, so it can write incoming/
ssh-keyscan -p 22 localhost           # the host key line, for DEPLOY_KNOWN_HOSTS (use the public name)
```

`deploy` cannot run `routeflow`, `sudo` or anything else that changes the server; it only drops files in
`incoming/`, which the server checks before it uses them.

On GitHub, Settings, Environments, `production`: secrets `DEPLOY_HOST`, `DEPLOY_USER` (`deploy`),
`DEPLOY_SSH_KEY` (the private half), `DEPLOY_KNOWN_HOSTS`, optionally `DEPLOY_PORT`; variable
`DEPLOY_ARCH` if the server is ARM (`arm64`). Add yourself as a required reviewer there if each deploy
should wait for a click. While `DEPLOY_HOST` is empty the deploy job does nothing.

Not tested yet: whether GitHub's runners reach an Arvan VPS on SSH from outside Iran. If they cannot,
copy the tarball by hand (`scp` to `incoming/`) or pull it from the server with `gh release download`.

## The monitor on the Pi

`deploy/monitor/routeflow-monitor` runs on the second machine every minute and tells the owner on
Telegram, with SMS through Farazsms (the IPPanel Edge API) for what cannot wait:

- the app is down after 2 failed health checks in a row; SMS too after 5 minutes down, or at once when
  Telegram cannot be reached; a "back up" message after;
- the newest backup on the Pi older than 26 hours: Telegram and SMS, once;
- the Pi's backup disk 80% full: Telegram, once a day;
- a daily summary at 09:00 Tehran, and a test on both channels on the 1st of each month.

Install on the Pi: copy the file over, `sudo bash routeflow-monitor install`, fill in
`/etc/routeflow-monitor.conf`, then `routeflow-monitor test`. Telegram is filtered inside Iran, so a home
Pi needs `TELEGRAM_PROXY` (a local proxy) or relies on SMS. The SMS call follows IPPanel's published
`POST /api/send` webservice format and has not been tried with a real Farazsms key.
