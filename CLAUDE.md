@AGENTS.md

# Batch rule: do all the tasks, then merge once at the end

Finish the whole list of tasks first, then merge. CI is slow, so do not stop and wait on it between tasks.

- One commit per task, with its own message, on the designated branch. Push as you go.
- Keep a single open pull request for the branch and update its description as commits are added. Do not merge, and do not wait for CI, between tasks.
- When every task is done, wait for CI on the final head, then merge the pull request once, with a merge commit so each task's commit stays visible in history.
- Only merge when the PR has no conflicts and CI is not failing; otherwise fix that first, then merge. If `main` moved, merge it into the branch and resolve conflicts before the final merge.
- If the branch has no open PR when the tasks are finished, open one (merging was asked for); if the task list was only a question, do not create one.
- This replaces the earlier rule of merging after every commit and push.

# Always-on: to-do report after every prompt

At the end of every reply, update `TODO-REPORT.md` at the repo root and show the same content concisely in the reply. Three lists, in this order:

- **Done** — checked items, one line each.
- **Not done / gaps** — unchecked items and known limits.
- **Next steps** — numbered, in the order they will be worked.

Keep it current: move items from Next steps to Done as they finish, add new gaps as they are found. Commit `TODO-REPORT.md` together with the work it describes.
