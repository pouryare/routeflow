---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** This is the "execute in the current session, task-by-task" path. If you want each task isolated in its own fresh context with automatic review gates, use `/long-haul-development.md` instead — it relays the plan across `/newtask` tasks and keeps state on disk so the whole job stays under your context budget.

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create the todo list and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed
5. **Context-budget check (every task, before starting the next).** This workflow holds the plan + the codebase you've touched + the conversation all in one context — it does not survive a large job. Check Cline's context usage. If it's getting high (rule of thumb: past ~60% of your window, or anywhere near where the model degrades), **stop — do not start another task.** Switch to `/long-haul-development.md`: write `.cline/plan.md` (this plan, with completed tasks checked off) and `.cline/journal.md` (what's done, which files matter and why, gotchas, what's next), then `/newtask` to continue from there. Pushing through a full context window costs you more than the switch does.

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use /finishing-a-development-branch.md
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **/using-git-worktrees.md** - Ensures isolated workspace (creates one or verifies existing)
- **/writing-plans.md** - Creates the plan this skill executes
- **/finishing-a-development-branch.md** - Complete development after all tasks
