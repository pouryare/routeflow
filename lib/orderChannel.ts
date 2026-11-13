/** F85: how an order reached the company. One tap at order entry; a driver's order is «سر در» without asking. */
export const ORDER_CHANNELS = [
  { id: "phone", label: "تماس تلفنی" },
  { id: "visit", label: "بازدید حضوری" },
  { id: "message", label: "پیام (واتساپ، تلگرام)" },
  { id: "driver", label: "راننده، سر در" },
  { id: "standing", label: "سفارش ثابت" },
  { id: "other", label: "سایر" },
] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number]["id"];

export const isOrderChannel = (v: unknown): v is OrderChannel => ORDER_CHANNELS.some((c) => c.id === v);

export const orderChannelLabel = (id: string | null): string => ORDER_CHANNELS.find((c) => c.id === id)?.label ?? "بدون ثبت";
