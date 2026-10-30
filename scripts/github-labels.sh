#!/usr/bin/env bash
# Creates or updates the labels in docs/github-workflow.md section 2, folds the
# GitHub starter labels into them and removes the ones the rule drops.
# Safe to run again. Uses the REST API only (gh api), so it also works where
# GraphQL is blocked. Usage: scripts/github-labels.sh [owner/repo]
set -euo pipefail

REPO="${1:-pouryare/routeflow}"

# name|colour|description
LABELS=(
  "type: bug|d73a4a|Something built does the wrong thing"
  "type: feature|0e8a16|Something new a person can see or use"
  "type: improvement|a2eeef|A built thing made better, no new ability"
  "type: security|b60205|A hole, a leak, or a missing check"
  "type: performance|fbca04|Speed, size, memory"
  "type: accessibility|f143ab|Someone with a disability is blocked"
  "type: docs|0075ca|Only documents change"
  "type: chore|c5def5|Tooling, CI, dependencies, clean-up"
  "area: crm|5319e7|Customers, leads, visits, pipeline"
  "area: orders|5319e7|Orders, prices, discounts, promotions"
  "area: delivery|5319e7|Runs, routing, drivers, maps"
  "area: stock|5319e7|Warehouse, products, suppliers, purchase"
  "area: money|5319e7|Credit, payments, cheques, cash in hand"
  "area: accounting|5319e7|Ledger, reports, profit, shareholders"
  "area: people|5319e7|Users, roles, approvals, commission"
  "area: platform|5319e7|Database, server, security, sync, backups, CI"
  "area: mobile|5319e7|Phone UI, offline, input, help, motion"
  "area: messaging|5319e7|SMS, push, Telegram, telephony, chat"
  "priority: p0|b60205|Drop everything: data loss, money wrong, security hole in use"
  "priority: p1|d93f0b|This batch"
  "priority: p2|fbca04|Next batch"
  "priority: p3|c2e0c6|Some day"
  "status: needs decision|d4c5f9|Waiting for the owner to choose (also asked in an Open Question card)"
  "status: blocked|000000|Waiting on something outside the repo; the issue says what"
)

# old name|new name: renamed so issues and PRs keep their label
RENAMES=(
  "bug|type: bug"
  "enhancement|type: improvement"
  "documentation|type: docs"
  "accessibility|type: accessibility"
  "question|status: needs decision"
)

REMOVE=("duplicate" "invalid" "wontfix" "good first issue" "help wanted")

enc() { jq -rn --arg s "$1" '$s|@uri'; }
exists() { gh api "repos/$REPO/labels/$(enc "$1")" --silent 2>/dev/null; }

for pair in "${RENAMES[@]}"; do
  old="${pair%%|*}" new="${pair#*|}"
  if exists "$old" && ! exists "$new"; then
    gh api -X PATCH "repos/$REPO/labels/$(enc "$old")" -f new_name="$new" --silent
    echo "renamed  $old -> $new"
  fi
done

for row in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$row"
  if exists "$name"; then
    gh api -X PATCH "repos/$REPO/labels/$(enc "$name")" -f color="$color" -f description="$desc" --silent
    echo "updated  $name"
  else
    gh api "repos/$REPO/labels" -f name="$name" -f color="$color" -f description="$desc" --silent
    echo "created  $name"
  fi
done

for name in "${REMOVE[@]}"; do
  if exists "$name"; then
    gh api -X DELETE "repos/$REPO/labels/$(enc "$name")" --silent
    echo "removed  $name"
  fi
done
