/** FB9 phase 1: a chat thread on an order or a customer. Pure. */

import { SELL_ROLES, type Role } from "@/lib/roles";

/** Who may chat: the people who sell and deliver, and the rep manager. Not shareholders or the back office. */
export const CHAT_ROLES: Role[] = [...SELL_ROLES, "rep_manager"];
export const canChat = (r: Role | string | null | undefined): boolean => CHAT_ROLES.includes(r as Role);

const CHAT_RECORDS = ["order", "customer"] as const;
export type ChatRecord = (typeof CHAT_RECORDS)[number];
export const isChatRecord = (v: unknown): v is ChatRecord => CHAT_RECORDS.includes(v as ChatRecord);

export const MAX_CHAT_CHARS = 1000;
export const CHAT_PAGE = 50;

/** The text to save, or null when it is empty or too long. Plain text only; the screen never renders it as markup. */
export function cleanBody(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  return s.length >= 1 && s.length <= MAX_CHAT_CHARS ? s : null;
}

export interface ChatMessage { id: number; authorId: number; author: string; body: string; at: string }
