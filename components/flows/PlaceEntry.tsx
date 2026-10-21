"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import PlaceFlow from "./PlaceFlow";

/** «افزودن مکان» on the sites page, phone only; the inline form stays from md up. */
export default function PlaceEntry({ onAdded }: { onAdded: () => void }) {
  const [flow, setFlow] = useState({ key: 0, open: false });
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-accent px-4 text-[length:var(--text-sm)] font-medium text-accent-ink"
      >
        <Icon name="plus" size="md" />
        افزودن مکان
      </button>
      {flow.key > 0 && (
        <PlaceFlow
          key={flow.key}
          open={flow.open}
          onAdded={onAdded}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
