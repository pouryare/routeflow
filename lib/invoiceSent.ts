/** FB38: how a receipt left the phone. Pure, shared by the printer, the route and the customer page. */
const INVOICE_VIA = { bluetooth: "چاپ بلوتوث", share: "ارسال", pdf: "PDF", print: "چاپ" } as const;
export type InvoiceVia = keyof typeof INVOICE_VIA;

export const isInvoiceVia = (v: unknown): v is InvoiceVia => typeof v === "string" && Object.hasOwn(INVOICE_VIA, v);
