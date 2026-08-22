#!/usr/bin/env bash
# Commits and pushes whatever changed, once per finished Claude turn (Stop hook).
#
# Per turn rather than per edit on purpose: a commit fired after each individual
# Write/Edit would record half-applied states -- a lib change without the test that
# covers it, a route without the helper it imports -- none of which build.
#
# A turn that already made its own commit lands here with a clean tree, so this only
# pushes. Anything Claude left uncommitted gets an "Auto-commit" of its own.

set -uo pipefail

REPO="/root/pourya/coverage-map"
cd "$REPO" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

emit() { jq -nc --arg m "$1" '{systemMessage: $m}'; }

# Belt and braces over .gitignore: an auto-push is unattended, so a credential or the
# customer database must not reach the remote merely because nobody ignored it yet.
SECRETS=(":(glob)**/.env" ":(glob)**/.env.*" ":(glob)**/*.pem" ":(glob)**/*.key"
         ":(glob)**/*.p12" ":(glob)**/*.db" ":(glob)**/*.sqlite*")

summary=""
if [ -n "$(git status --porcelain)" ]; then
  git add -A

  held_back=$(git diff --cached --name-only -- "${SECRETS[@]}" 2>/dev/null)
  [ -n "$held_back" ] && git reset -q -- "${SECRETS[@]}" 2>/dev/null

  if ! git diff --cached --quiet; then
    files=$(git diff --cached --name-only)
    count=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
    shown=$(printf '%s\n' "$files" | head -3 | sed 's#.*/##' | paste -sd', ')
    [ "$count" -gt 3 ] && shown="$shown (+$((count - 3)) more)"

    git commit -q -F - <<EOF || exit 0
Auto-commit: $shown

$files

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
    summary="committed $count file(s)"
  fi

  if [ -n "$held_back" ]; then
    summary="${summary:+$summary; }left uncommitted (looks sensitive): $(printf '%s' "$held_back" | paste -sd', ')"
  fi
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if git rev-parse --verify --quiet "origin/$branch" >/dev/null; then
  unpushed=$(git log --oneline "origin/$branch..HEAD" | wc -l | tr -d ' ')
  if [ "$unpushed" -eq 0 ]; then
    [ -n "$summary" ] && emit "Auto-commit: $summary (nothing to push)"
    exit 0
  fi
else
  # Branch has never been pushed -- everything on it is unpushed.
  unpushed=$(git log --oneline | wc -l | tr -d ' ')
fi

if ! push_error=$(git push --quiet -u origin "$branch" 2>&1); then
  emit "Auto-push to $branch FAILED -- ${unpushed} commit(s) still local: ${push_error}"
  exit 0
fi

emit "Auto-pushed ${unpushed} commit(s) to origin/$branch${summary:+ ($summary)}"
exit 0
