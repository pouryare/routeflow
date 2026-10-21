import { describe, it, expect } from "vitest";
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { labelCells } from "@/lib/tableCards";

const render = (rows: unknown, head: string[]) => renderToStaticMarkup(h("table", null, h("tbody", null, labelCells(rows as never, head))));

describe("table rows as cards", () => {
  it("labels every cell after the first with its column header", () => {
    const out = render(h("tr", { key: 1 }, h("td", null, "اجاره"), h("td", null, "۵۰"), h("td", null, "۶۰")), ["حساب", "مبلغ", "سهم"]);
    expect(out).toContain('<td>اجاره</td>');
    expect(out).toContain('<td data-label="مبلغ">۵۰</td>');
    expect(out).toContain('<td data-label="سهم">۶۰</td>');
  });
  it("works for mapped arrays and fragments", () => {
    const rows = [1, 2].map((i) => h("tr", { key: i }, h("td", null, `a${i}`), h("td", null, `b${i}`)));
    const out = render(h(Fragment, null, rows), ["x", "y"]);
    expect(out.match(/data-label="y"/g)).toHaveLength(2);
  });
  it("a colSpan cell skips the columns it covers", () => {
    const out = render(h("tr", null, h("td", { colSpan: 2 }, "جمع"), h("td", null, "۹")), ["a", "b", "c"]);
    expect(out).toContain('<td data-label="c">۹</td>');
    expect(out).not.toContain('data-label="b"');
  });
  it("a header that is not text gives no label, and non-row children are left alone", () => {
    const out = render([h("tr", { key: 1 }, h("td", null, "x"), h("td", null, "y"))], [""]);
    expect(out).not.toContain("data-label");
    expect(renderToStaticMarkup(h("div", null, labelCells("متن", ["a"])))).toBe("<div>متن</div>");
  });
});
