"use client";

/** "Someone else has this open" (idea L6). Example: Sara opens order 1042 while the manager has it
 *  open; a small chip under the title says «مدیر هم این سفارش را باز کرده است», so neither saves
 *  over the other without knowing. Nothing shows when you are the only one.
 *
 *  The page says it is open every 20 seconds and says goodbye when it closes; the list of who else
 *  is looking comes back on the live stream (topic "viewing") the moment it changes. */
import { useEffect, useState } from "react";
import { Chip } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { onLive, onLiveOpen } from "@/lib/live/client";
import { faNum } from "@/lib/format";

type ViewedType = "order" | "run" | "customer";
interface Viewer {
  id: number;
  name: string;
}

const PING_MS = 20_000;
const NOUN: Record<ViewedType, string> = { order: "سفارش", run: "مسیر", customer: "مشتری" };

/** The chip's text, or null when nobody else is looking. */
export function viewingText(viewers: readonly Viewer[], me: number | null, type: ViewedType): string | null {
  const others = viewers.filter((v) => v.id !== me);
  if (others.length === 0) return null;
  const who = others.length === 1 ? others[0].name : `${others[0].name} و ${faNum(others.length - 1)} نفر دیگر`;
  return `${who} هم این ${NOUN[type]} را باز ${others.length === 1 ? "کرده است" : "کرده‌اند"}`;
}

export default function ViewingChip({ type, id }: { type: ViewedType; id: number }) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [me, setMe] = useState<number | null>(null);

  useEffect(() => {
    let gone = false;
    const say = async (leave = false) => {
      try {
        const res = await fetch("/api/live/viewing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, id, leave }),
          keepalive: leave, // still sent while the page is closing
        });
        const body = (await res.json()) as { ok?: boolean; me?: number; viewers?: Viewer[] };
        if (!gone && body.ok) {
          setMe(body.me ?? null);
          setViewers(body.viewers ?? []);
        }
      } catch {
        /* offline: the chip simply shows nothing */
      }
    };
    void say();
    const timer = setInterval(() => document.visibilityState === "visible" && void say(), PING_MS);
    const offLive = onLive("viewing", (data) => {
      const d = data as { type?: string; id?: number; viewers?: Viewer[] } | null;
      if (d && d.type === type && d.id === id && Array.isArray(d.viewers)) setViewers(d.viewers);
    });
    const offOpen = onLiveOpen(() => void say());
    const bye = () => void say(true);
    window.addEventListener("pagehide", bye);
    return () => {
      gone = true;
      clearInterval(timer);
      offLive();
      offOpen();
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, [type, id]);

  const text = viewingText(viewers, me, type);
  return (
    <div role="status" aria-live="polite" data-tour="viewing-chip">
      {text && (
        <Chip size="sm" className="w-fit gap-1.5 bg-[var(--surface-2)] whitespace-normal text-[var(--foreground)]">
          <span className="text-[var(--accent)]"><Icon name="eye" size="sm" /></span>
          <Chip.Label>{text}</Chip.Label>
        </Chip>
      )}
    </div>
  );
}
