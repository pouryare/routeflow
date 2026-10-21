/** One-time sign-in details for a new account, made on the device so the person creating the
 *  account never has to invent a username or a password. The random source is passed in (the
 *  browser's `crypto.getRandomValues` in the app, a fixed one in tests). Letters that look alike
 *  (0/O, 1/l/I) are left out of the password because it will be read aloud or retyped. */
export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const USERNAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const PASSWORD_LENGTH = 10;
export type RandomBytes = (n: number) => Uint8Array;

export const browserRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

function pick(alphabet: string, n: number, rand: RandomBytes): string {
  // Bytes above the largest multiple of the alphabet length are skipped, so no character is likelier.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < n) {
    for (const b of rand(n * 2)) {
      if (b < limit && out.length < n) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export const generatePassword = (rand: RandomBytes = browserRandom) => pick(PASSWORD_ALPHABET, PASSWORD_LENGTH, rand);
/** `user-` and five characters: inside the server's 3-40 Latin letters/digits/dash rule. */
export const generateUsername = (rand: RandomBytes = browserRandom) => `user-${pick(USERNAME_ALPHABET, 5, rand)}`;
