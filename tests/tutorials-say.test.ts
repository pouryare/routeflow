import { describe, it, expect } from "vitest";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import { SAY } from "@/lib/tutorials/content/say";

/** The voice reads `say`, the card shows `text`. Taking the vowel marks away must give the same
 *  words, so a typo in the marked-up line cannot change what the voice says. */
const MARKS = /[ً-ْٰ]/g;
const words = (s: string) =>
  s.replace(MARKS, "").replace(/[«»()؟?!.,،:…]/g, " ").replace(/ه\u0654/g, "هی").replace(/\u200c/g, "").toLowerCase().split(/\s+/).filter(Boolean);

/** Lines whose spoken form deliberately differs: a Latin name, digits and a dropped ellipsis. */
const SPOKEN_REWRITE = new Set([
  "جواب‌ها را بزنید: صحبت کردیم، جواب نداد یا مشغول بود. برنامه کار بعدی را خودش می‌سازد، مثلاً «فردا ساعت ۱۰ دوباره زنگ بزن».",
  "کد را در برنامهٔ Google Authenticator اضافه کنید و عدد شش‌رقمی را اینجا بنویسید.",
  "در این بخش نام کالا، واحد (مثلاً کیلو) و وزن هر واحد را بنویسید.",
]);

describe("tutorial voice text", () => {
  it("every step has a diacritised line", () => {
    const missing = TUTORIALS.flatMap((t) => t.steps.map((s, i) => (s.say ? "" : `${t.id}-${i}`))).filter(Boolean);
    expect(missing).toEqual([]);
  });
  it("the marked-up line says the same words as the card", () => {
    const bad: string[] = [];
    for (const [text, say] of Object.entries(SAY)) {
      if (SPOKEN_REWRITE.has(text)) continue;
      if (words(text).join(" ") !== words(say).join(" ")) bad.push(text);
    }
    for (const t of TUTORIALS) for (const s of t.steps) if (s.say && s.say !== SAY[s.text] && !SPOKEN_REWRITE.has(s.text) && words(s.text).join(" ") !== words(s.say).join(" ")) bad.push(s.text);
    expect(bad).toEqual([]);
  });
  it("every line in the list belongs to a step", () => {
    const texts = new Set(TUTORIALS.flatMap((t) => t.steps.map((s) => s.text)));
    expect(Object.keys(SAY).filter((k) => !texts.has(k))).toEqual([]);
  });
});
