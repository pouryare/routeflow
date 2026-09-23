"use client";

import { Icon } from "@/components/meridian/Icon";
import { LEAD_VIEWS, readViewMode, saveViewMode, type LeadViewMode } from "@/lib/leadViews";

interface PoolViewToggleProps {
  activeView: LeadViewMode;
  onChange: (mode: LeadViewMode) => void;
}

export default function PoolViewToggle({ activeView, onChange }: PoolViewToggleProps) {
  return (
    <div className="pool-toggle-bar flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label="نمای لیست لیدها">
      {LEAD_VIEWS.map((view) => {
        const isActive = view.mode === activeView;
        return (
          <button
            key={view.mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={view.label}
            onClick={() => { onChange(view.mode); saveViewMode(view.mode); }}
            className={`pool-toggle-item flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-2 text-[length:var(--text-sm)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] whitespace-nowrap ${
              isActive
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:border-accent hover:text-accent"
            }`}
          >
            <Icon name={view.icon as any} size="sm" />
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
