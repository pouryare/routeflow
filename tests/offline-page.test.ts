import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OfflinePage from "@/app/(bare)/offline/page";

/** The page the service worker shows with no connection. Its buttons must work for every
 *  role: a retry of the page asked for, and a way home that does not assume a role. */
describe("offline page", () => {
  const html = renderToStaticMarkup(createElement(OfflinePage));

  it("offers a retry first", () => {
    expect(html).toContain("تلاش دوباره");
    expect(html.indexOf("تلاش دوباره")).toBeLessThan(html.indexOf("صفحهٔ اصلی"));
  });

  it("sends the reader home through /, which knows their role, never to the map", () => {
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/map"');
  });
});
