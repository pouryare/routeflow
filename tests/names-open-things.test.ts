import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CustomerName from "@/components/CustomerName";

/** «Wherever a name appears, tapping it opens that thing.» Each list below used to print the
 *  name as plain text while a page for it existed one search away. */
describe("names open what they name", () => {
  it("a customer name opens the customer", () => {
    expect(renderToStaticMarkup(createElement(CustomerName, { id: 7, name: "فروشگاه نمونه" }))).toContain('href="/crm/7"');
  });

  it("with no customer id it stays plain text, rather than a link to nowhere", () => {
    expect(renderToStaticMarkup(createElement(CustomerName, { id: null, name: "—" }))).not.toContain("<a");
  });

  const src = (f: string) => fs.readFileSync(f, "utf8");
  it.each([
    ["the order page", "app/(shell)/sales/orders/[id]/page.tsx", /<CustomerName id=\{order\.customer_id\}/],
    ["the payments list", "components/sales/PaymentsPanel.tsx", /<CustomerName id=\{p\.customer_id\}/],
    ["the complaints list", "components/sales/ComplaintsPanel.tsx", /<CustomerName id=\{c\.customer_id\}/],
    ["payables (supplier)", "app/(shell)/accounting/payables/page.tsx", /href=\{`\/accounting\/suppliers\/\$\{r\.supplierId\}`\}/],
    ["the balance sheet (account)", "app/(shell)/accounting/balance-sheet/page.tsx", /href=\{`\/accounting\/ledger\/\$\{r\.accountId\}`\}/],
    ["profit and loss (expense account)", "app/(shell)/accounting/income-statement/page.tsx", /ledgerOf: e\.accountId/],
  ])("%s links the name", (_what, file, pattern) => {
    expect(src(file)).toMatch(pattern);
  });
});
