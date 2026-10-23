"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@heroui/react";

/** A checkbox and its words as one tap target: HeroUI's Checkbox, whose Content is the label,
 *  so a tap anywhere on the row toggles it, at least 44 px tall. `children` is the visible
 *  label; `label` names a checkbox that has none (a row selector). */
export default function CheckField({
  checked,
  onChange,
  disabled = false,
  label,
  className = "",
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Checkbox isSelected={checked} onChange={onChange} isDisabled={disabled} className="checkfield">
      <Checkbox.Content aria-label={label} className={`checkfield__hit ${className}`.trim()}>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {children}
      </Checkbox.Content>
    </Checkbox>
  );
}
