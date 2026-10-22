/** The lead-run routes' view of lib/repo/leadRuns.ts: the same readers and writers, with the database
 *  handle held here instead of in each route. Every one already takes the company (or the session,
 *  which carries it). */

import { getDb } from "@/lib/db";
import {
  assignableDrivers,
  createOrReuseLeadRun,
  readLeadRun,
  readLeadRunAssignments,
  readScopedLeadRuns,
  readTodaysLeadRun,
  updateLeadRun,
} from "@/lib/repo/leadRuns";
import type { Session } from "@/lib/session";

type CreateInput = Parameters<typeof createOrReuseLeadRun>[2];
type UpdateInput = Parameters<typeof updateLeadRun>[3];

export const todaysRun = (driverUserId: number, orgId: number, todayIso: string) => readTodaysLeadRun(getDb(), driverUserId, orgId, todayIso);
export const driversFor = (session: Session) => assignableDrivers(getDb(), session);
export const assignmentsFor = (session: Session) => readLeadRunAssignments(getDb(), session);
export const runsFor = (session: Session) => readScopedLeadRuns(getDb(), session);
export const createRunFor = (session: Session, input: CreateInput) => createOrReuseLeadRun(getDb(), session, input);
export const runById = (id: number, orgId: number) => readLeadRun(getDb(), id, orgId);
export const updateRunFor = (session: Session, id: number, patch: UpdateInput) => updateLeadRun(getDb(), session, id, patch);
