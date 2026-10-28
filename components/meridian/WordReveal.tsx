import { splitWords } from "@/lib/words";

/** A heading whose words arrive one after another, fading up. Pure CSS (see `.wr` in
 *  app/globals.css), so it works from a server component and adds no script.
 *
 *  Real spaces stay between the word spans, so a screen reader and copy-paste read the
 *  heading as the plain sentence it is.
 *
 *  shortcut: it plays on every mount, not once per day; a per-day rule needs client state
 *  and would flash the plain heading first. Revisit if page titles feel repetitive. */
export default function WordReveal({ text }: { text: string }) {
  return (
    <>
      {splitWords(text).map((w, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <span className="wr" style={{ "--wr-i": Math.min(i, 8) } as React.CSSProperties}>
            {w}
          </span>
        </span>
      ))}
    </>
  );
}
