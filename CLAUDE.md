@AGENTS.md

# Auto-merge rule

After every commit and push, merge the branch's open pull request into `main` automatically, without asking first.

- Only merge when the PR has no conflicts and CI is not failing; otherwise fix that first, then merge.
- If the branch has no open PR, do not create one just to merge it. Say so instead.

# Always-on: to-do report after every prompt

At the end of every reply, update `TODO-REPORT.md` at the repo root and show the same content concisely in the reply. Three lists, in this order:

- **Done** — checked items, one line each.
- **Not done / gaps** — unchecked items and known limits.
- **Next steps** — numbered, in the order they will be worked.

Keep it current: move items from Next steps to Done as they finish, add new gaps as they are found. Commit `TODO-REPORT.md` together with the work it describes.
