import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/meridian/Icon";

/** A whole-screen state: not found, something broke, offline, no access.
 *
 *  Slice N: the app had no not-found, error or global-error page at all, so a mistyped
 *  address or a crash showed the framework's bare default in English. Every such state now
 *  wears one layout: an icon, a one-line eyebrow saying which state this is, a title that
 *  says what happened, a hint that says what to do, and the action that does it. The
 *  offline page used to carry the English word «Offline» as its eyebrow; it uses this too.
 *
 *  Server-safe (no hooks), so the error boundaries (client) and the 404 (server) share it.
 *  Styles: `.statepage` in app/globals.css. */
export default function StatePage({
  icon,
  eyebrow,
  title,
  hint,
  actions,
  code,
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  /** A reference the reader can quote to support (an error digest). Shown small. */
  code?: string;
}) {
  return (
    <main className="statepage" dir="rtl">
      <div className="statepage__card">
        <span className="statepage__icon" aria-hidden="true">
          <Icon name={icon} size="lg" />
        </span>
        <p className="statepage__eyebrow">{eyebrow}</p>
        <h1 className="statepage__title">{title}</h1>
        {hint ? <p className="statepage__hint">{hint}</p> : null}
        {actions ? <div className="statepage__actions">{actions}</div> : null}
        {code ? (
          <p className="statepage__code">
            کد پیگیری: <bdi>{code}</bdi>
          </p>
        ) : null}
      </div>
    </main>
  );
}
