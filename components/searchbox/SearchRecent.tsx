"use client";

import { Icon } from "@/components/meridian/Icon";
import { clearAllRecent, loadRecent, removeRecent } from "@/components/searchbox/searchBoxStore";

/** Recent searches, shown while the box is empty. */
export default function SearchRecent({ recentSearches, setRecentSearches, changeQuery, setOpen }: {
  recentSearches: string[];
  setRecentSearches: (r: string[]) => void;
  changeQuery: (q: string) => void;
  setOpen: (open: boolean) => void;
}) {
  if (!(recentSearches.length > 0)) return null;
  return (
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1 text-[length:var(--text-xs)] text-text-faint font-medium"><Icon name="clock" size="sm" /> Recent</span>
              <button onClick={() => { clearAllRecent(); setRecentSearches([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">
              <Icon name="x" size="sm" />
              Clear all</button>
            </div>
            {recentSearches.map((r, i) => (
              <button key={i} onClick={() => { changeQuery(r); setOpen(true); }} className="mapsearch__opt">
                <Icon name="clock" size="sm" />
                <span className="mapsearch__label">{r}</span>
                <button onClick={(e) => { e.stopPropagation(); removeRecent(r); setRecentSearches(loadRecent()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove recent"><Icon name="x" size="sm" /></button>
              </button>
            ))}
          </div>
  );
}
