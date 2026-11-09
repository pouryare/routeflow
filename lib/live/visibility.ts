/* The record check behind live events that name a record (idea L1, borrowed from PocketBase, where
 * a subscription runs the record's view rule before each message). Server only. */
import { canReachEntity, groupFilter, orderFilter, scopeView, type Session } from "@/lib/session";
import { isVanRole } from "@/lib/roles";
import { orderPasses, runPasses } from "@/lib/repo/liveVisibility";

/** Whether this session may see this record. Unknown types are refused: a new kind of record
 *  stays silent until someone writes its rule here. */
export async function canSeeRecord(session: Session, type: string, id: number): Promise<boolean> {
  if (type === "order") return await orderPasses(id, orderFilter(session));
  if (type === "customer") return await canReachEntity(session, "customer", id);
  if (type === "run") {
    const view = scopeView(session);
    if (isVanRole(view.role)) return await runPasses(id, session.organizationId, { driverId: session.user.id });
    return await runPasses(id, session.organizationId, await groupFilter(session, "dr.group_id"));
  }
  return false;
}
