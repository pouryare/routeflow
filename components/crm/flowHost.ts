
/** How a page hosts a flow sheet.
 *  onHide: the sheet slides away (done countdown, ✕, swipe) -- the component stays mounted,
 *          so a held save still sends and its undo can still reopen the sheet.
 *  onReopen: undo, or tapping the same business again while a draft is open.
 *  onFinished: the save reached the server -- unmount, refresh, highlight. */
export interface FlowHostProps {
  open: boolean;
  onHide: () => void;
  onReopen: () => void;
  onFinished: (customerId: number) => void;
}
