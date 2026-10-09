---
name: ultrathink
description: Use on complex, ambiguous, or high-stakes tasks when you need maximum reasoning depth - forces an explicit multi-phase reasoning pass written out before acting, and guards against stopping the thinking early.
---

# Ultrathink

> **Announce at start:** "Using ultrathink — extended reasoning before I act."

You were invoked because this task is hard enough that a fast, first-pass answer is likely to be wrong, incomplete, or shallow. This workflow exists to counteract one specific failure mode: **stopping the reasoning the moment a plausible answer appears.** A plausible first answer is a *hypothesis*, not a conclusion. Treat it as something to attack, not something to ship.

You do not have a choice about this. If `/ultrathink.md` was invoked, you run the full protocol below and you **write the phases out as visible output** before you act or give a final answer. Reasoning you don't write down is reasoning you didn't check.

## The Protocol

Work through every phase. Produce a short written artifact for each — terse is fine, *skipped is not*. If any phase sends you backward (it should, at least once, on a genuinely hard task), go back.

### Phase 1 — Restate
- In your own words: what is actually being asked? Not what's literally typed — what's the underlying goal?
- What is the success criterion? How will you (and the user) know it's done and correct?
- What is explicitly **out of scope** or **not** being asked?
- If the request is ambiguous in a way that changes the answer: stop and ask. Do not guess on a load-bearing ambiguity.

### Phase 2 — Assumptions
- List every assumption you're relying on. Be exhaustive — include the ones that feel too obvious to state; those are the ones that bite.
- Tag each: **verified** / **unverified** / **unverifiable**.
- For every *unverified* assumption that the answer depends on: verify it now — read the file, run the check, search the code, ask the user. Do not proceed on an unverified load-bearing assumption.

### Phase 3 — Approaches
- Enumerate at least **2–3 genuinely different** ways to do this. If you can only think of one, you haven't thought hard enough — push for the awkward alternative.
- For each: how it works, what it costs (effort, complexity, risk, blast radius), where it breaks, and why you would or wouldn't pick it.
- Do **not** collapse to a single approach yet.

### Phase 4 — Adversarial pass (the one people skip)
Now attack your leading candidate as if a sharp reviewer were trying to reject it:
- What input, state, or condition breaks it? Enumerate edge cases concretely.
- What are the failure modes? What happens when each one fires?
- What did you *not* consider? What's the second-order effect? What does this touch that you haven't looked at?
- Is there a simpler solution you talked yourself out of? Is there a hidden requirement?
- If you find a real hole: **go back to Phase 3.** Finding nothing on the first adversarial pass of a hard task usually means you didn't push hard enough — push again.

### Phase 5 — Decide
- State the choice.
- State the reasoning **that survived Phase 4** — not the reasoning that made it look good initially.
- State what you are explicitly **not** doing, and why that's the right call.
- State your confidence and what would change your mind.

### Phase 6 — Plan
- Break the execution into concrete, ordered steps *before touching anything*.
- For each step, note how you'll verify it.
- If the task is creative/feature work, this is the point to hand off to `/brainstorming.md`. If it's a bug, to `/systematic-debugging.md`. If it's plan execution, to `/writing-plans.md` → `/long-haul-development.md` (or `/executing-plans.md` for a small plan). Ultrathink is orthogonal — it makes the *front* of those workflows rigorous; it doesn't replace them.

## You're Stopping Too Early

These thoughts are the sound of the thinking ending one step short. When you notice one, that's the signal to keep going, not to stop.

| Thought | Reality |
|---|---|
| "I've got it — let me just start." | A first answer is a hypothesis. Run the adversarial pass before you commit. |
| "This is straightforward." | Then the protocol costs you a minute. If it isn't, the protocol just saved you an hour. |
| "I considered the alternatives in my head." | Then writing them down takes seconds. Comparison on the page reveals what introspection misses. |
| "I don't need to write the reasoning out." | Unwritten reasoning is unchecked reasoning. The writing *is* the thinking. |
| "I'll handle the edge cases as I hit them." | Edge cases found mid-implementation cost 10×. Find them in Phase 4, now. |
| "I already know this domain." | Knowing the domain ≠ having reasoned about *this* problem. Reason about this problem. |
| "The user is waiting." | The user typed `/ultrathink`. They chose depth over speed. Honoring that *is* serving them. |
| "Good enough." | "Good enough" is almost always the feeling of stopping one step early. Take the step. |
| "I can't think of another approach." | You haven't pushed hard enough. The third option is usually the awkward one you dismissed. |
| "Nothing breaks it." | You haven't attacked it hard enough. Attack it again, meaner. |

## Completion Gate

Do **not** begin execution and do **not** deliver a final answer until Phases 1–6 are visibly complete in your output. If you catch yourself acting (editing, running, answering) before the gate, **stop**, return to the protocol, finish it, then proceed.

## A Note on Thinking Budget

If your model supports an extended-thinking / reasoning channel, use it — *and* still produce the written phase artifacts here. They're complementary: the hidden channel is yours, the written artifacts are checkable by you and the user. If your model's hidden reasoning tends to cut out early, the written protocol is your real safeguard — do not skimp on it. The cost of over-thinking a hard problem is minutes. The cost of under-thinking one is the rework, the wrong turn, and the user's trust.

## When to Use

**Use when:** the task is architecturally significant, ambiguous, high-blast-radius, security- or data-sensitive, has burned you before, or just *feels* like the kind of thing where a quick answer would be a guess. Use it whenever the user invokes `/ultrathink.md`.

**Don't bother when:** the task is genuinely mechanical and reversible (rename a variable, fix an obvious typo, run a command you've run a hundred times). Ceremony on trivial work is its own waste — but when in doubt, run it; the protocol is cheap on easy tasks and decisive on hard ones.
