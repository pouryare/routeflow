/** A short, human label for a browser's user-agent string («Chrome روی Android»), for the sign-in
 *  log. A guess from well-known tokens, not a parser: an unknown string reads «دستگاه نامشخص». */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "دستگاه نامشخص";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "Mac"
          : /Linux/i.test(ua)
            ? "Linux"
            : null;
  // Order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  if (!os && !browser) return "دستگاه نامشخص";
  if (!os) return browser!;
  if (!browser) return os;
  return `${browser} روی ${os}`;
}
