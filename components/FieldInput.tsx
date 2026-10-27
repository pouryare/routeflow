"use client";

import type { ComponentProps } from "react";
import { Input, TextArea } from "@heroui/react";

/** The bare text field: HeroUI's Input, with the native `<input>` props and a native change event,
 *  for the many places that already have their own label, layout and state (a table cell, a
 *  search box, a row of fields). Use `TextInput` instead when the field needs a label and an
 *  error line of its own. The look (fill, border, focus ring, 44 px) comes from HeroUI. */
export function FieldInput({ className = "", ...props }: ComponentProps<typeof Input>) {
  return <Input className={`fieldinput ${className}`.trim()} {...props} />;
}

/** Same for a multi-line field. */
export function FieldArea({ className = "", ...props }: ComponentProps<typeof TextArea>) {
  return <TextArea className={`fieldinput ${className}`.trim()} {...props} />;
}
