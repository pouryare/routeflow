import type { Map as LeafletMap } from "leaflet";

/** The slice of leaflet-routing-machine this app actually uses.
 *
 *  The plugin attaches itself to the global `L` at runtime and ships no type definitions
 *  in this build, which is why both map components reached for `(L as any).Routing`. That
 *  cast switched off checking for everything downstream of it -- the control, its events,
 *  and every field read off a route. Declaring only the shapes that are used keeps the
 *  checking and still tells the truth: this is an untyped plugin, and here is precisely
 *  how much of it we depend on.
 *
 *  Shared rather than repeated: LeadsMap and PlannerRouteMap had the same two casts, so
 *  a change to the plugin would otherwise have to be found in two places.
 */
export interface RouteSummaryRaw {
  /** Metres. */
  totalDistance: number;
  /** Seconds. */
  totalTime: number;
}

export interface RoutesFoundEvent {
  routes?: { summary: RouteSummaryRaw }[];
}

export interface RoutingControl {
  on(event: "routesfound", handler: (e: RoutesFoundEvent) => void): void;
  on(event: "routingerror", handler: () => void): void;
  addTo(map: LeafletMap): void;
  remove(): void;
}

/** `L` with the plugin's namespace attached. Options stay loose because the plugin's own
 *  option set is large and undocumented here; the return value is what mattered. */
export interface RoutingRouter {
  route(waypoints: unknown, callback: (...args: unknown[]) => void, context?: unknown, options?: unknown): void;
}

export interface WithRouting {
  Routing: {
    control(options: Record<string, unknown>): RoutingControl;
    /** The default OSRM v1 router the control builds for itself when none is given. */
    osrmv1(options?: Record<string, unknown>): RoutingRouter;
  };
}
