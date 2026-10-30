/** A heading's words, for the word-by-word reveal. Whole words, never letters: Persian
 *  letters join, and a letter in its own box is drawn in its isolated form. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
