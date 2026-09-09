export type ButtonState = "idle" | "loading" | "success";
export type ButtonEvent = "click" | "resolve" | "reject" | "timeout";

/** idle -> loading -> success -> idle. Confirmed live in the reference video on "Take
 *  for Processing" and "Add Case" -- this is not a speculative addition. Extracted as a
 *  pure reducer so the transition logic is unit-testable without rendering a component. */
export function nextButtonState(state: ButtonState, event: ButtonEvent): ButtonState {
  if (state === "idle" && event === "click") return "loading";
  if (state === "loading" && event === "resolve") return "success";
  if (state === "loading" && event === "reject") return "idle";
  if (state === "success" && event === "timeout") return "idle";
  return state; // any other (state, event) pair is a no-op, not an error
}
