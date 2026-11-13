"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import StickyAction from "@/components/mobile/StickyAction";

/** «خواندم» under a lesson: records it and shows it as read. */
export default function LessonDone({ slug, done }: { slug: string; done: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(done ? "done" : "idle");
  async function mark() {
    setState("busy");
    const res = await fetch("/api/sales/academy/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson_slug: slug }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }
  if (state === "done") {
    return <p className="acad__muted" role="status"><Icon name="check" size="sm" /> این درس را خوانده‌اید.</p>;
  }
  return (
    <>
      {state === "error" && <p className="acad__muted" role="alert">ثبت نشد؛ دوباره بزنید.</p>}
      <StickyAction label="خواندم" icon="check" onClick={() => void mark()} busy={state === "busy" ? "در حال ثبت…" : undefined} disabled={state === "busy"} />
    </>
  );
}
