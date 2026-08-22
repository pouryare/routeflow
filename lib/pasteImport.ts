// Parses a chat export (WhatsApp/Telegram-style, one `[date time] Sender: text` line
// per message, continuation lines unprefixed) pasted in from a coworker's conversation
// about prospective venues, pairing each Google/Neshan/Balad maps link with the venue
// name it was shared alongside. Pure and network-free -- link resolution happens later,
// server-side, once these {name, mapsUrl} pairs are known.

const MESSAGE_HEADER_RE = /^\[.*?\]\s*[^:]+:\s?(.*)$/;
const MAP_LINK_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|nshn\.ir|neshan\.org|balad\.ir|balad\.app)\/\S+/i;

export interface ParsedPasteItem {
  name: string;
  mapsUrl: string;
}

// Groups raw lines into whole messages: a line matching the header pattern starts a
// new message, everything after it (until the next header) is a continuation of it.
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
    const linkMatch = msg.match(MAP_LINK_RE);
    if (!linkMatch) continue;
    const mapsUrl = linkMatch[0];
    if (seenUrls.has(mapsUrl)) continue;

    let name = msg.replace(MAP_LINK_RE, "").trim();
    if (!name && i > 0) {
      // A message that's just a bare link -- fall back to the previous message's text
      // (still stripped of any link of its own, in case that one had a stray URL too).
      name = messages[i - 1].replace(MAP_LINK_RE, "").trim();
    }
    if (!name) continue;

    seenUrls.add(mapsUrl);
    items.push({ name, mapsUrl });
  }

  return items;
}
