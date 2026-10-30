"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import {
  DEFAULT_NAV_APP,
  NAV_APPS,
  NAV_APP_KEY,
  NAV_TEST_LABEL,
  NAV_TEST_POINT,
  NavAppId,
  isNavAppId,
  navigateUrl,
} from "@/lib/navApps";

/** Reads the chosen navigation app, and keeps every mounted copy in step.
 *
 *  localStorage fires no event in the tab that wrote it, so a change made in the map's
 *  settings would not reach the leads page open in the same session without this. The
 *  custom event is the missing half of the storage event.
 */
const CHANGE_EVENT = "coverage-nav-app-change";

export function useNavApp(): [NavAppId, (id: NavAppId) => void] {
  const [app, setApp] = useState<NavAppId>(DEFAULT_NAV_APP);

  useEffect(() => {
    const read = () => {
      try {
        const stored = localStorage.getItem(NAV_APP_KEY);
        setApp(isNavAppId(stored) ? stored : DEFAULT_NAV_APP);
      } catch {
        setApp(DEFAULT_NAV_APP);
      }
    };
    read();
    window.addEventListener(CHANGE_EVENT, read);
    // Fires for changes made in *other* tabs; the custom event covers this one.
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  function choose(id: NavAppId) {
    setApp(id);
    try {
      localStorage.setItem(NAV_APP_KEY, id);
    } catch {
      // Not remembered, but applied for this session.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [app, choose];
}

/** The picker. Lives in the map's settings section and on the leads page, because both
 *  are places you would go looking for it after a link opened the wrong app. */
export default function NavAppSetting() {
  const [app, choose] = useNavApp();

  return (
    <div>
      <p className="mb-1 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
        برنامه مسیریابی
      </p>
      <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
        هر دکمه «مسیریابی» در برنامه با این باز می‌شود.
      </p>

      <div className="flex flex-col gap-1">
        {NAV_APPS.map((a) => {
          const active = app === a.id;
          return (
            <div
              key={a.id}
              className={`rounded-[var(--radius-md)] border px-2.5 py-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                active ? "border-accent bg-accent/10" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => choose(a.id)}
                  role="radio"
                  aria-checked={active}
                  className="flex min-w-0 flex-1 items-center gap-2 text-right"
                >
                  <Icon name="check" size="md" />
                  <span
                    aria-hidden="true"
                    className={`h-3 w-3 shrink-0 rounded-full border ${
                      active ? "border-accent bg-accent" : "border-border-strong"
                    }`}
                  />
                  <span className={`text-[length:var(--text-sm)] ${active ? "text-accent" : "text-text"}`}>
                    {a.label}
                  </span>
                  {/* Said out loud rather than assumed: two of these formats could not
                      be checked against vendor documentation, and presenting them with
                      the same confidence as the other two would be a small lie that
                      costs a wrong turn. */}
                  {!a.verified && (
                    <span className="shrink-0 text-[length:var(--text-xs)] text-warn">تأییدنشده</span>
                  )}
                </button>

                {/* Five seconds on the sofa instead of a surprise at a junction. */}
                <a
                  href={navigateUrl(a.id, NAV_TEST_POINT, NAV_TEST_LABEL)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
                >
                  <Icon name="external-link" size="sm" />
                  امتحان
                </a>
              </div>
              <p className="mt-1 text-[length:var(--text-xs)] leading-5 text-text-faint">{a.note}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
        دکمه «امتحان» باید {NAV_TEST_LABEL} را نشان دهد. اگر برنامه‌ای جای دیگری را باز کرد یا اصلاً باز نشد،
        گزینه «انتخاب توسط گوشی» همیشه کار می‌کند.
      </p>
    </div>
  );
}
