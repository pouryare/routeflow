import { vi } from "vitest";

/* Every bottom sheet is a HeroUI Drawer (BottomSheet), and React Aria renders no overlay during a server render
   (Modal returns null while SSR). These tests are about what the sheet says, not how it slides,
   so the Drawer becomes plain elements: shown while open, hidden while closed. The real Drawer
   is exercised in the browser (scripts/preview.sh, tests/smoke). */
vi.mock("@heroui/react", async (orig) => {
  const real = await orig<typeof import("@heroui/react")>();
  const { createElement, Fragment } = await import("react");
  type P = { children?: unknown; className?: string; [k: string]: unknown };
  const part = (tag: string, role?: string) => ({ children, className }: P) =>
    createElement(tag, { className, role }, children as never);
  // A closed sheet stays in the markup, hidden, the way the hand-built sheets were: tests read
  // what a sheet would offer without having to open it in a server render.
  const Root = ({ isOpen, children }: P) =>
    isOpen ? createElement(Fragment, null, children as never) : createElement("div", { hidden: true }, children as never);
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
