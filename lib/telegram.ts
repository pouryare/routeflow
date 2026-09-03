/** STUB — Task 5 replaces this file with sendTelegram/editTelegram + a real config gate.
 *  Signature is fixed: telegramConfigured(): boolean. */
export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}
