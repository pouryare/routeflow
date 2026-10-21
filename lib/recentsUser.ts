/** Whose history the pickers on this device read and write. The header knows who is signed in
 *  (it reads the session); the pickers on the page below it do not, and a shared tablet must not
 *  mix two people's "usual customers". The header sets it once (components/mobile/RecentsUser),
 *  and pickers read it lazily when they open. 0 until set: history under 0 is simply unshared
 *  with anyone else. */
let current = 0;
export const setRecentsUser = (id: number): void => {
  current = id;
};
export const getRecentsUser = (): number => current;
