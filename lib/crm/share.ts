import { faToman } from "@/lib/format";

export function priceListText(products: { id: number; name: string; price_toman: number | null }[], chosenIds: string[]): string {
  const list = chosenIds.length ? products.filter((p) => chosenIds.includes(String(p.id))) : products;
  const lines = list.map((p) => `• ${p.name} — ${p.price_toman === null ? "استعلام" : faToman(p.price_toman)}`);
  return ["فهرست قیمت امروز:", ...lines].join("\n");
}

export function shareUrl(channel: "whatsapp" | "telegram", phoneNorm: string | null, text: string): string {
  const t = encodeURIComponent(text);
  if (channel === "whatsapp") return `https://wa.me/${phoneNorm ? `98${phoneNorm}` : ""}?text=${t}`;
  return `https://t.me/share/url?url=%20&text=${t}`;
}
