/** The message a person sees when a request fails.
 *
 *  API routes answer 4xx with short strings meant for whoever wrote the client:
 *  «شناسه نامعتبر است», «بدنه درخواست نامعتبر است», «id لازم است», «یافت نشد». A person
 *  at a restaurant door can do nothing with those, and they could not have caused them:
 *  the screen built the request, not the person. Those are replaced by the caller's
 *  own sentence, which says what failed and what to do next.
 *
 *  Messages a person CAN act on («نام گروه الزامی است», «رمز عبور باید حداقل ۸ نویسه باشد»,
 *  «این نام کاربری از قبل گرفته شده است») pass through unchanged.
 */

/** Latin tokens a reader recognises. Any other Latin word in a message is a field name
 *  leaking from the code («id», «entity», «enabled», «lat, lng»). */
const READABLE_LATIN = /\b(PDF|CSV|GPS|URL|SMS|PIN|Ctrl)\b/g;

/** Shapes that mean "the request was malformed", never "you typed something wrong". */
const MALFORMED: RegExp[] = [
  // «شناسه نامعتبر است», «شناسهٔ کالا معتبر نیست», «بدنه درخواست نامعتبر است»,
  // «پارامتر read نامعتبر است», «کنش مشخص نشده», «نشانگر تاریخچه نامعتبر است»
  /^(شناسه|بدنه|پارامتر|کنش|نشانگر|درخواست|اشتراک|تنظیمات)\S*(\s\S+){0,3}\s(نامعتبر|معتبر نیست|مشخص نشده|لازم است)/,
  // «نوع موجودیت نامعتبر است», «نوع تخلیه نامعتبر است»
  /^نوع\s(موجودیت|تخلیه|تاریخچه|مکان|اعلان)\s/,
  // «کانال نامعتبر است»
  /^کانال نامعتبر/,
  // Bare, subjectless messages
  /^(یافت نشد|خطا|خطای ناشناخته|کنش ناشناخته|نامعتبر)$/,
];

/** «کسب‌وکار پیدا نشد» says which record, but not that it was probably deleted or that
 *  refreshing is the fix. Only short messages: «هیچ لینک نقشه‌ای در متن پیدا نشد» is a
 *  statement about what the person typed, not about a missing record. */
const NOT_FOUND = /(پیدا|یافت) نشد$/;
const NOT_FOUND_HINT = "؛ ممکن است حذف شده باشد. صفحه را تازه کنید.";

export function isTechnicalMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  if (/\$\{|undefined|\[object|SQLITE|UNIQUE/.test(m)) return true;
  if (/[A-Za-z]/.test(m.replace(READABLE_LATIN, ""))) return true;
  return MALFORMED.some((re) => re.test(m));
}

/** The text to show for a failed request.
 *
 *  @param serverMessage whatever the server sent as `error`; anything else is ignored.
 *  @param fallback what failed and what to do, in the caller's words —
 *                  «گروه حذف نشد؛ دوباره تلاش کنید». */
export function friendlyError(serverMessage: unknown, fallback: string): string {
  if (typeof serverMessage !== "string") return fallback;
  const m = serverMessage.trim();
  if (isTechnicalMessage(m)) return fallback;
  if (NOT_FOUND.test(m) && m.split(/\s+/).length <= 3) return `${m}${NOT_FOUND_HINT}`;
  return m;
}
