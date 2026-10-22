"use client";

import { Icon } from "@/components/meridian/Icon";
import { FAV_KEY, Favorite, loadFavorites, removeFavorite } from "@/components/searchbox/searchBoxStore";

/** Saved favourites, shown while the box is empty. */
export default function SearchFavorites({ favorites, setFavorites, changeQuery, setOpen }: {
  favorites: Favorite[];
  setFavorites: (f: Favorite[]) => void;
  changeQuery: (q: string) => void;
  setOpen: (open: boolean) => void;
}) {
  if (!(favorites.length > 0)) return null;
  return (
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1 text-[length:var(--text-xs)] text-text-faint font-medium"><Icon name="star" size="sm" /> Favorites</span>
              <button onClick={() => { localStorage.removeItem(FAV_KEY); setFavorites([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">
              <Icon name="x" size="sm" />
              Clear all</button>
            </div>
            {favorites.map((f) => (
              <button key={f.id} onClick={() => { changeQuery(f.label); setOpen(true); }} className="mapsearch__opt">
                <Icon name="star" size="sm" />
                <span className="mapsearch__label">{f.label}</span>
                <button onClick={(e) => { e.stopPropagation(); removeFavorite(f.id); setFavorites(loadFavorites()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove favorite"><Icon name="x" size="sm" /></button>
              </button>
            ))}
          </div>
  );
}
