/** A small coin that turns over once: for the moment cash arrives (the cash done-screen, the earnings card).
 *  CSS only. `spinKey` changing replays the turn. Hidden from screen readers (decoration). */
export default function Coin({ spinKey = 0, size = 28 }: { spinKey?: number | string; size?: number }) {
  return (
    <span className="coin" key={spinKey} style={{ width: size, height: size }} aria-hidden="true">
      <span className="coin__face">ت</span>
    </span>
  );
}
