# Before making the repository public

The scan on 2026-10-27 (gitleaks over all 283 commits and branches) found no API keys or tokens;
its 50 hits were test constants. Two things remain.

## 1. Remove the old database from history

`.zoocode/mcp/routeflow-mcp.db` was committed once and later removed and ignored (`/.zoocode/`),
but it is still in history. It holds 6 users (scrypt password hashes, phone numbers) and 16
customer rows. Do this on your own computer, in a fresh clone, when no thread is working:

```sh
pip install git-filter-repo
git clone git@github.com:pouryare/routeflow.git routeflow-clean && cd routeflow-clean
git filter-repo --invert-paths --path .zoocode/
git remote add origin git@github.com:pouryare/routeflow.git   # filter-repo removes it
git push --force --all origin
```

Then delete every other copy: stale clones, open cloud sessions (start new ones), and open
branches (rebase them onto the new `main`). Old commits stay reachable on GitHub by hash for a
while; to purge them ask GitHub Support to run garbage collection, or create a new repository
from the cleaned clone instead.

## 2. Other steps

- If the `pourya` password was ever used anywhere real, change it.
- Re-run `gitleaks detect --log-opts="--all"` after the rewrite.
- `LICENSE` is "all rights reserved"; replace it if you want others to use the code.
- Read `TODO-REPORT.md` and `docs/architecture-audit-*.md`: they list known weaknesses.
- Keep keys (Farazsms, `SESSION_SECRET`, database passwords) only on the server.
- Public repositories get free standard runners, so Actions minutes stop mattering.
