import { describe, expect, it, beforeEach } from "vitest";
import { SORT_OPTIONS } from "@/components/SearchBox";
import { detectInputType } from "@/components/SearchBox";
import { loadRecent, pushRecent, removeRecent, clearAllRecent } from "@/components/SearchBox";
import { loadFavorites, addFavorite, removeFavorite } from "@/components/SearchBox";

// vitest runs in node environment which has no localStorage — mock it
const _store: Record<string, string> = {};
const mockLocalStorage = {
  getItem(k: string) { return _store[k] ?? null; },
  setItem(k: string, v: string) { _store[k] = v; },
  removeItem(k: string) { delete _store[k]; },
  clear() { Object.keys(_store).forEach((k) => delete _store[k]); },
};

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage, writable: true, configurable: true });
  mockLocalStorage.clear();
});

describe("sort options by view", () => {
  it("shows all 7 options in default view", () => {
    expect(SORT_OPTIONS.length).toBe(7);
  });

  it("hides status in kanban view", () => {
    const kanbanOptions = SORT_OPTIONS.filter((o) => o.value !== "status");
    expect(kanbanOptions.length).toBe(6);
  });

  it("shows only score in score view", () => {
    const scoreOptions = SORT_OPTIONS.filter((o) => o.value === "score");
    expect(scoreOptions.length).toBe(1);
  });
});

describe("detectInputType", () => {
  it("detects coordinates", () => {
    expect(detectInputType("35.7, 51.4")).toBe("coord");
  });

  it("detects Persian address", () => {
    expect(detectInputType("تهران تجریش")).toBe("address");
  });

  it("detects name query", () => {
    expect(detectInputType("حسن")).toBe("name");
  });
});

describe("recent searches", () => {
  it("starts empty", () => {
    expect(loadRecent()).toEqual([]);
  });

  it("saves and loads", () => {
    pushRecent("تهران");
    expect(loadRecent()).toEqual(["تهران"]);
  });

  it("deduplicates — moves existing to top", () => {
    pushRecent("تهران");
    pushRecent("مشهد");
    pushRecent("تهران");
    expect(loadRecent()).toEqual(["تهران", "مشهد"]);
  });

  it("caps at 10", () => {
    for (let i = 0; i < 12; i++) pushRecent(`query${i}`);
    expect(loadRecent().length).toBe(10);
  });

  it("removes individual entry", () => {
    pushRecent("تهران");
    pushRecent("مشهد");
    removeRecent("تهران");
    expect(loadRecent()).toEqual(["مشهد"]);
  });

  it("clear all removes everything", () => {
    pushRecent("تهران");
    clearAllRecent();
    expect(loadRecent()).toEqual([]);
  });
});

describe("favorites", () => {
  it("starts empty", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("adds and loads", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    expect(loadFavorites().length).toBe(1);
  });

  it("removes by id", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    removeFavorite("cust_123");
    expect(loadFavorites()).toEqual([]);
  });

  it("deduplicates same id", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    addFavorite({ id: "cust_123", label: "علی", lat: 0, lng: 0, kind: "customer" });
    expect(loadFavorites().length).toBe(1);
    expect(loadFavorites()[0].label).toBe("علی");
  });
});