# If something breaks, read this first

One page for a person who did not build the system. Find the line that matches what you see, run the command, and open the page it names. Everything runs on the server with `sudo routeflow`; with no arguments it opens a menu of the same commands.

| What you see | First, run | Then read |
|---|---|---|
| The site does not open for anyone | `sudo routeflow status` (service, health, disk, last backup) | [release-and-deploy.md](release-and-deploy.md), «The routeflow command» |
| It broke right after an update | `sudo routeflow rollback` (back to the previous release; the last 3 are kept) | [release-and-deploy.md](release-and-deploy.md), «When an upgrade fails its checks» |
| An upgrade stopped half way | `sudo routeflow logs` | the same section: a migration marked `contract` stops and waits for a person |
| Pages open but are slow, or errors in the app | `sudo routeflow logs` | [postgres-server.md](postgres-server.md), «Day to day» (slow statements are in the PostgreSQL log) |
| Notifications, reminders or follow-up tasks do not come | open «وضعیت سامانه» as owner: events still waiting, last worker run | [release-and-deploy.md](release-and-deploy.md), «Background worker»; [events.md](events.md) |
| Photos or receipts do not upload | the owner page «فضای ذخیره‌سازی» (is a storage set and reachable?) | [storage.md](storage.md) |
| A table or a day of data was deleted by mistake | do not touch the database; stop the app | [postgres-server.md](postgres-server.md), «Restoring» (restore to a time minutes before) |
| The server machine is gone | install on a new machine with the same backup settings | [postgres-server.md](postgres-server.md), «Restoring», «The machine is gone» |
| The monthly restore check failed | `sudo routeflow restore-drill` and read its output | [postgres-server.md](postgres-server.md), «Day to day» |
| A company's address or certificate does not work | `routeflow arvan-probe` (read-only report) | [release-and-deploy.md](release-and-deploy.md), «Company addresses» |
| Someone cannot sign in | an owner opens «کاربران» to reset the password; two-step codes are reset there too | the Academy lesson «ورود امن» |
| A person leaves or goes on long leave | an owner opens «کاربران», card «واگذاری کارهای یک همکار» | `docs/plans/academy-catalogue-independence-2026-11-12.md` (F59) |
| Who changed a price, a credit limit or a role? | «وضعیت سامانه», card «تاریخچهٔ تغییرات» | [events.md](events.md) (what is an event, what is the audit record) |

**Night order on the server (Tehran time):** 01:30 backup, 02:30 reboot if an update needs one, 03:30 app upgrade, 04:00 on the 1st the restore drill.

**Secrets** (`routeflow secrets list | set | unset | backup | restore`) are encrypted on the server; keep a printed copy of the `secrets backup` file and the backup cipher pass in the owner's private repository, not on the server.
