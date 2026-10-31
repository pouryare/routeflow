"use client";

import { useState } from "react";
import { splitWords } from "@/lib/words";

/** A done-screen headline whose words tumble off when tapped and come back on the next tap. Whole
 *  words only (Persian letters join). Real spaces stay, so a screen reader reads the sentence. */
export default function TumbleWords({ text }: { text: string }) {
  const [fallen, setFallen] = useState(false);
  return (
    <button type="button" className="tumble" aria-label={text} aria-pressed={fallen} onClick={() => setFallen((f) => !f)}>
      {/* No icon: the headline's own words are the whole button, and a glyph beside them would read as an action. */}
      {splitWords(text).map((w, i) => (
        <span key={i} aria-hidden="true">
          {i > 0 ? " " : null}
          <span className="tumble__w" data-fallen={fallen} style={{ "--tw-i": i } as React.CSSProperties}>{w}</span>
        </span>
      ))}
    </button>
  );
}
