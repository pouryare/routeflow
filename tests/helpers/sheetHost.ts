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
