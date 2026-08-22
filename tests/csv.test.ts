import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    const csv = toCsv([["a", "b"], ["c", "d"]]);
    expect(csv.replace(/^﻿/, "")).toBe("a,b\r\nc,d");
  });

  it("prefixes a UTF-8 BOM", () => {
    const csv = toCsv([["x"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv([["a,b", 'has "quotes"', "line\nbreak"]]);
    expect(csv.replace(/^﻿/, "")).toBe('"a,b","has ""quotes""","line\nbreak"');
  });

  it("renders null/undefined as empty strings", () => {
    const csv = toCsv([["x", null, undefined]]);
    expect(csv.replace(/^﻿/, "")).toBe("x,,");
  });

  it("stringifies numbers", () => {
    const csv = toCsv([[1, 2.5]]);
    expect(csv.replace(/^﻿/, "")).toBe("1,2.5");
  });
});
