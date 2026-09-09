import type { ReactNode } from "react";

/** Temporary passthrough. Replaced by the real shell in the next commit — it exists now
 *  so the route group is valid and the directory move can be reviewed on its own. */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
