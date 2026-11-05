import { Icon } from "@/components/meridian/Icon";
import type { ShapeHint } from "@/lib/fieldShape";

/** The line under a fixed-shape field while typing (lib/fieldShape.ts): red with what is missing,
 *  or a check when it is right. Polite live region, so a screen reader hears it settle. */
export default function FieldShapeHint({ hint, id }: { hint: ShapeHint; id?: string }) {
  return (
    <p id={id} className="fieldshape" data-tone={hint?.tone} aria-live="polite">
      {hint ? (
        <>
          <Icon name={hint.tone === "ok" ? "check" : "info"} size="sm" className={hint.tone === "ok" ? "done-check" : undefined} />
          {hint.text}
        </>
      ) : null}
    </p>
  );
}
