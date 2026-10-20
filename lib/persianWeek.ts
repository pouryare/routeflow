/** Calendar-grid arithmetic shared by the streak and driver-load grids, which draw the same
 *  Saturday-to-Friday week and must agree on where it starts. All UTC, on `YYYY-MM-DD`
 *  civil dates, so a day is always exactly `DAY` ms and DST/zone can never shift a cell. */

export const DAY = 86_400_000;

/** `YYYY-MM-DD` -> UTC midnight in ms. */
export const toMs = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** UTC ms -> `YYYY-MM-DD`. */
export const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 0 for Saturday … 6 for Friday. */
export const persianWeekday = (ms: number) => (new Date(ms).getUTCDay() + 1) % 7;
