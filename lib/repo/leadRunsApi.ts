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

export const todaysRun = async (driverUserId: number, orgId: number, todayIso: string) => await readTodaysLeadRun(getDb(), driverUserId, orgId, todayIso);
export const driversFor = async (session: Session) => await assignableDrivers(getDb(), session);
export const assignmentsFor = async (session: Session) => await readLeadRunAssignments(getDb(), session);
export const runsFor = async (session: Session) => await readScopedLeadRuns(getDb(), session);
export const createRunFor = async (session: Session, input: CreateInput) => await createOrReuseLeadRun(getDb(), session, input);
export const runById = async (id: number, orgId: number) => await readLeadRun(getDb(), id, orgId);
export const updateRunFor = async (session: Session, id: number, patch: UpdateInput) => await updateLeadRun(getDb(), session, id, patch);
