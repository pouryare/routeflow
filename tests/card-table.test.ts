import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardTable from "@/components/CardTable";

describe("CardTable", () => {
  const html = renderToStaticMarkup(
    h(CardTable, {
      className: "w-full",
      children: [
        h("thead", { key: "h" }, h("tr", null, h("th", null, "نام"), h("th", null, "خرید ", 30, " روز"), h("th", null, h("b", null, "x")))),
        h("tbody", { key: "b" }, [1, 2].map((i) => h("tr", { key: i }, h("td", null, `a${i}`), h("td", null, `b${i}`), h("td", null, `c${i}`)))),
      ],
    }),
  );
  it("turns into cards: the card classes are on the table", () => {
    expect(html).toContain('class="acct-cards acct-cards--tiles w-full"');
  });
  it("the first cell is the title (no label), the others carry their header text", () => {
    expect(html).not.toContain('data-label="نام"');
    expect(html).toContain('data-label="خرید 30 روز"');
  });
  it("a header that is not plain text gives its cell no label", () => {
    expect(html.match(/data-label=/g)).toHaveLength(2 * 1);
  });
});
