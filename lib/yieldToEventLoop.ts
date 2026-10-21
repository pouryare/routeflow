/** Waits a moment so what has already rendered can be sent before heavy synchronous work.
 *
 *  A server component whose reads are all synchronous (node:sqlite) never actually waits for
 *  anything, so the server finishes it, and every sibling behind a Suspense boundary, without
 *  ever returning to the event loop, and the response goes out in one piece: the boundary is
 *  there but the shell is never sent ahead of the slow part. Awaiting this first lets the
 *  loop turn long enough to flush it.
 *
 *  A zero-length wait (setImmediate, setTimeout 0) is NOT enough: the render, the HTML
 *  stream and the socket write take several turns between them. Measured on a production
 *  build, a 0 ms yield delivered the shell together with the slow section (1.8 s) while 50 ms
 *  delivered it at ~90 ms; 75 ms leaves headroom. If the wait is ever too short the page
 *  simply arrives in one piece, as it did before. */
export const yieldToEventLoop = (ms = 75): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
