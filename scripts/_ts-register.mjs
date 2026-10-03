/** Registers the resolution hook. Used as `node --import ./scripts/_ts-register.mjs …`.
 *
 *  `registerHooks` (synchronous, in-thread) rather than `register` (async, off-thread,
 *  deprecated as of Node 26). */
import { registerHooks } from "node:module";
import { resolve } from "./_ts-hooks.mjs";

registerHooks({ resolve });
