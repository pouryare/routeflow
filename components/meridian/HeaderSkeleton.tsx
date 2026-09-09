/** The header's shape without its session.
 *
 *  Rendered while AppHeader resolves, so the chrome occupies its final height from the
 *  very first frame and nothing below it jumps when the real header swaps in. Static and
 *  session-free on purpose — being cheap is the entire job, because this is what lets
 *  the shell layout stay synchronous (see components/meridian/AppShell.tsx).
 *
 *  Not a client component: no state, no effects. `.skeleton` is the shared shimmer from
 *  app/globals.css that components/Skeleton.tsx also uses.
 */
export default function HeaderSkeleton() {
  return (
    <div className="chrome" aria-hidden="true">
      <div className="top">
        <div className="brandwrap">
          <span className="skeleton" style={{ width: 26, height: 14, display: "block" }} />
          <div>
            <span className="skeleton" style={{ width: 108, height: 17, display: "block" }} />
            <span
              className="skeleton"
              style={{ width: 152, height: 12, display: "block", marginTop: 6 }}
            />
          </div>
        </div>
        <div className="topright">
          <span
            className="skeleton"
            style={{ width: 34, height: 34, borderRadius: 999, display: "block" }}
          />
        </div>
      </div>
      <div className="segwrap">
        <nav className="seg seg-groups" />
      </div>
    </div>
  );
}
