import { encode } from "uqr";

/** A QR code drawn as SVG in the browser: the text (a secret) never leaves the page.
 *  Always black on white with a quiet border, in light and dark, so every scanner can read it. */
export default function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  const path: string[] = [];
  data.forEach((row, y) => row.forEach((on, x) => on && path.push(`M${x} ${y}h1v1h-1z`)));
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="mx-auto h-auto w-[min(60vw,14rem)] rounded-[var(--radius-md)]">
      <rect width={size} height={size} fill="#fff" />
      <path d={path.join("")} fill="#000" />
    </svg>
  );
}
