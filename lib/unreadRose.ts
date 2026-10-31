/** True when the unread count went up since the last time it was seen: the bell swings and sounds
 *  then. The first value seen (`prev` null, the page just loaded) and a fall (notifications read)
 *  are not news. */
export const unreadRose = (prev: number | null, next: number): boolean => prev !== null && next > prev;
