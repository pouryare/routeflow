import type { RoutingRouter, WithRouting } from "@/types/leafletRouting";

/** The routing plugin's own OSRM router, wrapped so an answer that arrives after the control
 *  was removed is dropped.
 *
 *  Removing a control while a request is in flight is routine here: a stop is added, the
 *  route is rebuilt, and the previous request is still waiting. When its answer lands the
 *  plugin draws it on a map the removed control no longer holds, and throws
 *  «Cannot read properties of null (reading 'removeLayer')» into the console. Nothing is
 *  wrong with the page — the answer is simply for a route that is gone — so it is ignored.
 */
export function guardedOsrmRouter(L: WithRouting): { router: RoutingRouter; dispose: () => void } {
  const base = L.Routing.osrmv1();
  let disposed = false;
  return {
    router: {
      route(waypoints, callback, context, options) {
        base.route(
          waypoints,
          (...args: unknown[]) => {
            if (!disposed) callback.apply(context, args);
          },
          context,
          options,
        );
      },
    },
    dispose: () => {
      disposed = true;
    },
  };
}
