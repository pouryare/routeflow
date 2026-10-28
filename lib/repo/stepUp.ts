/** Server side of step-up verification (rules in lib/stepUp.ts): the guard a sensitive route calls,
 *  and the company switch. A route that is refused answers 403 with a `step_up` object; the app's
 *  StepUpProvider asks for the code and repeats the request. */

import { NextRequest, NextResponse } from "next/server";
import { deriveKey } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { secondFactorRequired } from "./secondFactor";
import { STEP_UP_ACTIONS, TRUST_COOKIE, mintTrust, needsStepUp, readTrust, type StepUpAction } from "@/lib/stepUp";

const KEY_PURPOSE = "step-up-trust";
const trustKey = () => deriveKey(KEY_PURPOSE);

/** The person whose code counts: the real person under Login-As, never the one being acted as. */
export const verifierOf = (session: Session): number => session.actorId ?? session.user.id;

export async function stepUpRequiredFor(organizationId: number): Promise<boolean> {
  const row = await getDb().prepare("SELECT step_up_required FROM organizations WHERE id = ?").get(organizationId) as { step_up_required: boolean } | undefined;
  return !!row?.step_up_required;
}

export async function setStepUpRequired(organizationId: number, required: boolean): Promise<void> {
  await getDb().prepare("UPDATE organizations SET step_up_required = ? WHERE id = ?").run(required, organizationId);
}

async function tokenVersionOf(userId: number): Promise<number> {
  const row = await getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(userId) as { token_version: number } | undefined;
  return row?.token_version ?? 0;
}

/** Null when the caller may go ahead; otherwise the 403 to return. */
export async function guardStepUp(req: NextRequest, session: Session, action: StepUpAction): Promise<NextResponse | null> {
  if (!needsStepUp(session.role, action)) return null;
  if (!await stepUpRequiredFor(session.organizationId)) return null;
  const person = verifierOf(session);
  if (readTrust(trustKey(), req.cookies.get(TRUST_COOKIE)?.value, person, await tokenVersionOf(person))) return null;
  const meta = STEP_UP_ACTIONS[action];
  const enrolled = await secondFactorRequired(person);
  return NextResponse.json(
    {
      ok: false,
      error: enrolled
        ? `برای «${meta.label}» کد برنامهٔ احراز هویت لازم است`
        : `برای «${meta.label}» اول ورود دومرحله‌ای را در «امنیت حساب» فعال کنید`,
      step_up: { action, label: meta.label, critical: meta.critical, method: enrolled ? "totp" : "enroll" },
    },
    { status: 403 },
  );
}

/** The cookie that trusts this person for ten minutes on this device. */
export async function trustCookieFor(person: number): Promise<{ name: string; value: string; maxAge: number }> {
  return { name: TRUST_COOKIE, value: mintTrust(trustKey(), person, await tokenVersionOf(person)), maxAge: 10 * 60 };
}
