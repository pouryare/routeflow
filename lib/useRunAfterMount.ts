"use client";

import { useEffect } from "react";

/** Run an async loader once the component has mounted, and again whenever the loader
 *  itself changes (its useCallback dependencies).
 *
 *  Thirteen screens loaded their data as `useEffect(() => { load(); }, [load])`, each with
 *  an `eslint-disable` for set-state-in-effect and the same comment: the setState calls
 *  happen after load()'s first await, but the rule only sees a state-setting function
 *  called from the effect body. Starting the loader from a resolved promise makes that
 *  asynchrony explicit: nothing is set during the effect itself, so there is nothing to
 *  cascade and no rule to switch off. The loaders keep their names and are still called
 *  directly after a mutation, where no effect is involved. */
export function useRunAfterMount(load: () => unknown): void {
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
}
