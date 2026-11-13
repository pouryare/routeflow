"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/meridian/Icon";
import { useTutorials } from "@/components/tutorials/TutorialProvider";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import { tutorialsFor } from "@/lib/tutorials/engine";

const PhotoLightbox = dynamic(() => import("@/components/PhotoLightbox"), { ssr: false }) as typeof import("@/components/PhotoLightbox").default;

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "li"; items: string[] } | { kind: "img"; id: number } | { kind: "tut"; id: string };

const IMG = /^\[\[img:(\d+)\]\]$/;
const TUT = /^\[\[tutorial:([a-z0-9-]+)\]\]$/;

/** The lesson text is plain: `## ` starts a heading, `- ` a bullet, a line holding only `[[img:12]]` a
 *  picture, `[[tutorial:order-new]]` a «نشانم بده» button that starts that tutorial, anything else a paragraph. A leading `# ` line is the title and is shown by the page, not here.
 *  (docs/plans/academy-catalogue-independence-2026-11-12.md: no rich-text library.) */
export function parseLesson(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: "p", text: para.join(" ") }); para = []; };
  for (const raw of lines) {
    const line = raw.trim();
    const img = IMG.exec(line);
    const tut = TUT.exec(line);
    if (!line) flush();
    else if (line.startsWith("# ")) flush();
    else if (line.startsWith("## ")) { flush(); out.push({ kind: "h", text: line.slice(3) }); }
    else if (img) { flush(); out.push({ kind: "img", id: Number(img[1]) }); }
    else if (tut) { flush(); out.push({ kind: "tut", id: tut[1] }); }
    else if (line.startsWith("- ")) {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === "li") last.items.push(line.slice(2));
      else out.push({ kind: "li", items: [line.slice(2)] });
    } else para.push(line);
  }
  flush();
  return out;
}

/** «نشانم بده»: starts the tutorial for this screen. Nothing shows for an id the person's role has no tutorial under. */
function ShowMe({ id }: { id: string }) {
  const { role, start } = useTutorials();
  const t = role ? tutorialsFor(role, TUTORIALS).find((x) => x.id === id) : undefined;
  if (!t) return null;
  return (
    <button type="button" className="btn solid inline-flex min-h-[44px] items-center gap-[var(--space-2)]" onClick={() => start(t.id)}>
      <Icon name="play" size="md" /> نشانم بده: {t.title}
    </button>
  );
}

export default function LessonBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseLesson(text), [text]);
  const photos = useMemo(() => blocks.flatMap((b) => (b.kind === "img" ? [{ id: b.id }] : [])), [blocks]);
  const [open, setOpen] = useState(-1);
  return (
    <div className="lesson" dir="rtl">
      {blocks.map((b, i) => {
        if (b.kind === "h") return <h3 key={i} className="sechead__title sechead__title--minor">{b.text}</h3>;
        if (b.kind === "p") return <p key={i}>{b.text}</p>;
        if (b.kind === "tut") return <ShowMe key={i} id={b.id} />;
        if (b.kind === "li") return <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>;
        const at = photos.findIndex((p) => p.id === b.id);
        return (
          <button key={i} type="button" className="lesson__img" aria-label="بزرگ‌نمایی تصویر" onClick={() => setOpen(at)}>
            <img src={`/api/content-images/${b.id}/file`} alt="" loading="lazy" />
            <Icon name="maximize" size="sm" className="lesson__zoom" />
          </button>
        );
      })}
      {photos.length > 0 && <PhotoLightbox photos={photos} index={open} onClose={() => setOpen(-1)} srcOf={(id) => `/api/content-images/${id}/file`} />}
    </div>
  );
}
