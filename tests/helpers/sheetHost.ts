import { vi } from "vitest";

/* TapFlow draws its sheet through a portal into the `.meridian` root (useSheetHost), which is
   null on the server, so a server render of a sheet is empty. These tests assert the sheet's
   content, so they stand in a host and make the portal render in place. Import this FIRST in a
   test file, before the components, so the mocks are registered before they load. */
vi.mock("@/components/meridian/useSheetHost", () => ({ useSheetHost: () => ({}) }));
vi.mock("react-dom", async (orig) => ({
  ...(await orig<typeof import("react-dom")>()),
  createPortal: (children: unknown) => children,
}));

/* TapFlow's sheet is a HeroUI Drawer, and React Aria renders no overlay during a server render
   (Modal returns null while SSR). These tests are about what the sheet says, not how it slides,
   so the Drawer becomes plain elements that render their children while open. The real Drawer
   is exercised in the browser (scripts/preview.sh, tests/smoke). */
vi.mock("@heroui/react", async (orig) => {
  const real = await orig<typeof import("@heroui/react")>();
  const { createElement, Fragment } = await import("react");
  type P = { children?: unknown; className?: string; [k: string]: unknown };
  const part = (tag: string, role?: string) => ({ children, className }: P) =>
    createElement(tag, { className, role }, children as never);
  const Root = ({ isOpen, children }: P) => (isOpen ? createElement(Fragment, null, children as never) : null);
  const Drawer = Object.assign(Root, {
    Backdrop: part("div"),
    Content: part("div"),
    Dialog: part("section", "dialog"),
    Handle: part("div"),
    Header: part("header"),
    Heading: part("h2"),
    Body: part("div"),
    Footer: part("div"),
  });
  return { ...real, Drawer };
});
