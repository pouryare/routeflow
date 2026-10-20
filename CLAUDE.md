@AGENTS.md

# Auto-merge rule

After every commit and push, merge the branch's open pull request into `main` automatically, without asking first.

- Only merge when the PR has no conflicts and CI is not failing; otherwise fix that first, then merge.
- If the branch has no open PR, do not create one just to merge it. Say so instead.
