// Parses a chat export (WhatsApp/Telegram-style, one `[date time] Sender: text` line
// per message, continuation lines unprefixed) pasted in from a coworker's conversation
// about prospective venues, pairing each Google/Neshan/Balad maps link with the venue
// name it was shared alongside. A plain list of links with no names at all is equally
// valid input -- those items come back with an empty name, for the caller to fill in
// from the resolved place address. Pure and network-free: link resolution happens later,
// server-side, once these {name, mapsUrl} pairs are known.

const MESSAGE_HEADER_RE = /^\[.*?\]\s*[^:]+:\s?(.*)$/;
const MAP_LINK_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|nshn\.ir|neshan\.org|balad\.ir|balad\.app)\/\S+/gi;

// Same pattern, non-global: a /g regex carries lastIndex across .test() calls, so the
// two uses need separate objects even though they share one source.
const HAS_MAP_LINK_RE = new RegExp(MAP_LINK_RE.source, "i");

// Sentence punctuation the link-matching \S+ swallows when a link ends a sentence or sits
// inside brackets -- carried into the URL it would break resolution of an otherwise fine link.
const TRAILING_PUNCTUATION_RE = /[.,،؛;:!?)\]»"'“”]+$/;

export interface ParsedPasteItem {
  name: string;
  mapsUrl: string;
}

function linksIn(text: string): string[] {
  return (text.match(MAP_LINK_RE) ?? []).map((url) => url.replace(TRAILING_PUNCTUATION_RE, ""));
}

// Whatever the message says once its links are cut out of it -- collapsed onto one line,
// since the gap a removed link leaves behind (and a name split across continuation lines)
// would otherwise show up as ragged whitespace in the saved name.
function textWithoutLinks(message: string): string {
  return message.replace(MAP_LINK_RE, "").replace(/\s+/g, " ").trim();
}

// Groups raw lines into whole messages: a line matching the header pattern starts a
// new message, everything after it (until the next header) is a continuation of it.
// A line carrying a map link also *ends* its message, so that a headerless paste of
// alternating "name / link" lines splits into one message per venue rather than
// collapsing into a single message whose name is every other line glued together.
function groupIntoMessages(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const messages: string[] = [];
  let current: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headerMatch = line.match(MESSAGE_HEADER_RE);
    if (headerMatch) {
      if (current) messages.push(current.join("\n"));
      current = [headerMatch[1]];
    } else if (current) {
      current.push(line);
    } else {
      // No header seen yet -- tolerate plain "name\nlink" pastes with no chat prefix.
      current = [line];
    }
    if (current && HAS_MAP_LINK_RE.test(current[current.length - 1] ?? "")) {
      messages.push(current.join("\n"));
      current = null;
    }
  }
  if (current) messages.push(current.join("\n"));
  return messages;
}

export function parsePastedChat(text: string): ParsedPasteItem[] {
  const messages = groupIntoMessages(text);
  const items: ParsedPasteItem[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Every link in the message, not just the first -- one message can carry several
    // when a coworker lists two venues at once.
    const links = linksIn(msg);
    if (links.length === 0) continue;

    let name = textWithoutLinks(msg);
    if (!name && i > 0) {
      // A message that's just a bare link -- fall back to the previous message's text
      // (still stripped of any link of its own, in case that one had a stray URL too).
      name = textWithoutLinks(messages[i - 1]);
    }

    for (const mapsUrl of links) {
      if (seenUrls.has(mapsUrl)) continue;
      seenUrls.add(mapsUrl);
      // A link with nothing at all to name it still becomes an item: the venue name is
      // recovered from the resolved Google address server-side, which beats dropping
      // the link silently -- a bare list of links has no names to find anywhere else.
      items.push({ name, mapsUrl });
    }
  }

  return items;
}
