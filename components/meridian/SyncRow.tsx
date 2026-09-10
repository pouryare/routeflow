"use client";

import { since, syncBadge, useSyncState } from "@/components/SyncStatus";

/** The profile menu's «همگام‌سازی» row: the home the sync indicator lost in item 8.
 *
 *  The floating badge now says nothing when all is well (it printed «آنلاین» forever
 *  before). This row is where the calm state lives: «همگام» and when it last synced,
 *  or the same warning the badge would show. Same hook as the badge, so they agree. */
export default function SyncRow() {
  const { online, pending, trouble, lastSynced } = useSyncState();
  const badge = syncBadge({ online, pending, trouble });
  return (
    <div className="pm__row">
      <span>همگام‌سازی</span>
      <span className={`pm__sync pm__sync--${badge ? badge.tone : "good"}`}>
        {badge ? badge.label : `همگام · ${since(lastSynced)}`}
      </span>
    </div>
  );
}
