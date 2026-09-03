import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editTelegram, sendTelegram, telegramConfigured } from "@/lib/telegram";

const TOKEN = "test-token";
const realFetch = global.fetch;
const realToken = process.env.TELEGRAM_BOT_TOKEN;

/** A stand-in Response carrying only the two members lib/telegram reads: status + json(). */
function fakeResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

/** Install a vi.fn() as global.fetch; `handler` decides how each call resolves/rejects. */
function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})
  );
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

/** The URL + init of the first fetch call, narrowed away from `undefined`. */
function firstCall(mock: ReturnType<typeof stubFetch>): { url: string; init: RequestInit } {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("fetch was never called");
  return { url: String(call[0]), init: call[1] ?? {} };
}

beforeEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = realFetch;
  if (realToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = realToken;
});

describe("telegramConfigured", () => {
  it("is false when TELEGRAM_BOT_TOKEN is unset", () => {
    expect(telegramConfigured()).toBe(false);
  });

  it("is true when TELEGRAM_BOT_TOKEN is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    expect(telegramConfigured()).toBe(true);
  });
});

describe("sendTelegram", () => {
  it("POSTs sendMessage with a JSON chat_id + text body and returns { message_id } on ok:true", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const mock = stubFetch(async () => fakeResponse(200, { ok: true, result: { message_id: 7 } }));

    const out = await sendTelegram("42", "سلام");

    expect(out).toEqual({ message_id: 7 });
    expect(mock).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(mock);
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe("42");
    expect(body.text).toBe("سلام");
  });

  it("returns null (and warns) when fetch rejects", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(() => Promise.reject(new Error("network down")));

    expect(await sendTelegram("42", "x")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null (and warns) on ok:false", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => fakeResponse(400, { ok: false, description: "Bad Request" }));

    expect(await sendTelegram("42", "x")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null (and warns) on a malformed ok:true with no result key", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => fakeResponse(200, { ok: true }));

    expect(await sendTelegram("42", "x")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null (and warns) on ok:true with result: null", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => fakeResponse(200, { ok: true, result: null }));

    expect(await sendTelegram("42", "x")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null without touching fetch when the token is unset", async () => {
    const mock = stubFetch(async () => fakeResponse(200, { ok: true, result: { message_id: 1 } }));
    expect(await sendTelegram("42", "x")).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("editTelegram", () => {
  it("POSTs editMessageText with chat_id + message_id + text and returns true on ok:true", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const mock = stubFetch(async () => fakeResponse(200, { ok: true, result: { message_id: 7 } }));

    const ok = await editTelegram("42", 7, "به‌روزرسانی");

    expect(ok).toBe(true);
    const { url, init } = firstCall(mock);
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/editMessageText`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      chat_id: string;
      message_id: number;
      text: string;
    };
    expect(body.chat_id).toBe("42");
    expect(body.message_id).toBe(7);
    expect(body.text).toBe("به‌روزرسانی");
  });

  it("returns false on ok:false", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => fakeResponse(400, { ok: false }));

    expect(await editTelegram("42", 7, "x")).toBe(false);
  });

  it("returns false without touching fetch when the token is unset", async () => {
    const mock = stubFetch(async () => fakeResponse(200, { ok: true, result: {} }));
    expect(await editTelegram("42", 7, "x")).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});
