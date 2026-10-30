"use client";

import { Switch } from "@heroui/react";
import { playSound } from "@/lib/sound";

/** An on/off switch: HeroUI's Switch, with the 44 px tap area the mobile rules ask for around
 *  its 20 px track. The label is for screen readers; the row that holds the switch shows the
 *  visible words. React Aria brings the switch role, Space to toggle and the focus ring. */
export default function ToggleSwitch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  /** Called with nothing: every caller flips its own state. */
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Switch isSelected={on} onChange={() => {
      playSound("ui.toggle");
      onChange();
    }} isDisabled={disabled} className="toggle">
      <Switch.Content aria-label={label} className="toggle__hit">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
