/** The one way this app talks to OSRM: GET a URL, give up after `TIMEOUT_MS`, and answer
 *  `null` for anything that is not a usable JSON body.
 *
 *  `null` rather than a throw because every caller's fallback is the same -- the straight
 *  line -- and nothing a caller could do distinguishes "offline" from "OSRM said no route"
 *  from "OSRM returned something unrecognisable". Shared by the `/route` call (a corridor's
 *  geometry) and the `/table` call (a distance matrix), which used to carry a copy each. */

/** The public OSRM instance, so there is one host to allow in the CSP and one service to be
 *  down at a time. Individual endpoints may be overridden (see `osrmMatrix`). */
export const OSRM_BASE = "https://router.project-osrm.org";

const TIMEOUT_MS = 8000;

export async function fetchOsrmJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // Either the caller giving up or the clock running out ends the request.
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(url, { signal: combined });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
