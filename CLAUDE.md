@AGENTS.md

# Batch rule: do all the tasks, then merge once at the end

Finish the whole list of tasks first, then merge. CI is slow, so do not stop and wait on it between tasks.

- One commit per task, with its own message, on the designated branch. Push as you go.
- Keep a single open pull request for the branch and update its description as commits are added. Do not merge, and do not wait for CI, between tasks.
- When every task is done, wait for CI on the final head, then merge the pull request once, with a merge commit so each task's commit stays visible in history.
- Only merge when the PR has no conflicts and CI is not failing; otherwise fix that first, then merge. If `main` moved, merge it into the branch and resolve conflicts before the final merge.
- If the branch has no open PR when the tasks are finished, open one (merging was asked for); if the task list was only a question, do not create one.
- This replaces the earlier rule of merging after every commit and push.

# Always-on: look for existing solutions before building

Before adding any new functionality (a feature, helper, integration, UI primitive, parser, algorithm or script), search for something that already exists. Do not start writing it first.

1. **Search.** Use the web (WebSearch, WebFetch), the npm registry (`npm view <package> version time.modified`) and this repo (it may already have it). Look for open-source libraries, plugins, example code and self-hostable services.
2. **Analyze** each serious candidate on: what it covers of the need, licence, last release and maintenance, size, security record, fit with this stack (Next.js 16, TypeScript, PostgreSQL), Persian and right-to-left support, and the project's constraints: the server is in Iran, so no paid foreign API or key, and it must be self-hostable and installable from there.
3. **Ask the user to decide.** Give a short comparison and your recommendation: use library A, use B, or build from scratch (say what building costs and what it buys). Use AskUserQuestion. Do not add a dependency or start building until they answer.
4. **Record** the decision in the relevant doc (`docs/roadmap.md` section 10 or the feature's entry) and in `TODO-REPORT.md`.

When a batch of tasks is given (see the batch rule), do the search for all of them first and ask all the questions in one round, so the work is not interrupted between tasks.

Skip the search for: bug fixes, edits inside existing code, a few lines of glue, and anything the user has already told you to build or to use a named library for.

# Always-on: to-do report after every prompt

At the end of every reply, update `TODO-REPORT.md` at the repo root and show the same content concisely in the reply. Three lists, in this order:

- **Done** — checked items, one line each.
- **Not done / gaps** — unchecked items and known limits.
- **Next steps** — numbered, in the order they will be worked.

Keep it current: move items from Next steps to Done as they finish, add new gaps as they are found. Commit `TODO-REPORT.md` together with the work it describes.

# UI work follows the mobile-first rules

UI work follows `docs/mobile-first-principles.md` (and `docs/tap-flow-principles.md` for flows that record what just happened). Run `npm run check:mobile` before committing UI changes; it fails on a new `<select>`, native date, small tap target or confirm dialog, on a mobile component with no test, and on an allowlist entry without a written reason.
