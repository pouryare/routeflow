import { expect, it } from "vitest";
import { normPhone } from "@/lib/crm/phone";

it.each(["abc09120001234", "09120001234abc", "091200012345", "+44 9120001234", "0912!0001234", "letters", "0000000000"])("rejects invalid phone %s rather than stripping or truncating it", (value) => {
  expect(normPhone(value)).toBeNull();
});
it.each(["09120001234", "۰۹۱۲ ۰۰۰ ۱۲۳۴", "٠٩١٢ ٠٠٠ ١٢٣٤", "+98 (912) 000-1234", "0098 9120001234", "9120001234"])("accepts supported Iranian format %s", (value) => {
  expect(normPhone(value)).toBe("9120001234");
});
it("accepts a landline", () => expect(normPhone("021-7730-1105")).toBe("2177301105"));
