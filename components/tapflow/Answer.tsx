"use client";

import type { ReactNode } from "react";
import { Button, ListBox, SearchField, ToggleButton } from "@heroui/react";
import { Icon, type IconName } from "@/components/meridian/Icon";

/** The answer button every tap flow, picker and decision is made of: a HeroUI Button, or a
 *  HeroUI ToggleButton when it shows a current choice (`selected`), so the choice is announced
 *  as pressed. It keeps the `tf-opt` class, whose rules give it the 52 px answer size and the
 *  label-over-note column; `tone` adds `rec` / `bad` / any flow tone. */
export function AnswerButton({
  icon,
  selected,
  tone,
  isDisabled,
  onPress,
  ariaLabel,
  className = "",
  children,
}: {
  icon?: IconName;
  /** Given: the button shows whether it is the current choice. Omitted: a plain answer. */
  selected?: boolean;
  tone?: string;
  isDisabled?: boolean;
  onPress: () => void;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const cls = `tf-opt${tone ? ` ${tone}` : ""}${selected ? " on" : ""}${className ? ` ${className}` : ""}`;
  const body = (
    <>
      {icon ? <Icon name={icon} size="md" /> : null}
      {children}
    </>
  );
  if (selected === undefined) {
    return (
      <Button variant="secondary" className={cls} isDisabled={isDisabled} onPress={onPress} aria-label={ariaLabel}>
        {body}
      </Button>
    );
  }
  return (
    <ToggleButton className={cls} isSelected={selected} isDisabled={isDisabled} onChange={onPress} aria-label={ariaLabel}>
      {body}
    </ToggleButton>
  );
}

/** The quiet way out under a list of answers: «کالا مشخص نیست», «بستن». */
export function SkipButton({ icon = "arrow-left", onPress, children }: { icon?: IconName; onPress: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" className="tf-skip" onPress={onPress}>
      <Icon name={icon} size="md" />
      {children}
    </Button>
  );
}

/** The search box above a long list of answers: HeroUI's SearchField, 52 px, with a named
 *  clear button. Escape clears it, as React Aria's search field does. */
export function AnswerSearch({
  value,
  onChange,
  label,
  placeholder = "جستجو…",
  autoFocus,
}: {
  value: string;
  onChange: (q: string) => void;
  /** Names the field for a screen reader: «جستجوی مشتری». */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <SearchField value={value} onChange={onChange} aria-label={label} autoFocus={autoFocus} fullWidth className="tf-search">
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={placeholder} autoComplete="off" />
        <SearchField.ClearButton aria-label="پاک کردن جستجو" />
      </SearchField.Group>
    </SearchField>
  );
}

/** A long list of answers as a HeroUI ListBox: one tap picks, arrow keys move, a screen reader
 *  hears "list, 12 items". Rows keep the 52 px answer size (`.tf-list` rules). `selected` marks
 *  the current choice with a check; leave it undefined for a list of actions. */
export function AnswerList({
  items,
  selected,
  onPick,
  label,
  empty = "چیزی پیدا نشد",
}: {
  items: { id: string; label: string }[];
  selected?: string;
  onPick: (id: string) => void;
  label: string;
  empty?: string;
}) {
  return (
    <ListBox
      aria-label={label}
      className="tf-list"
      selectionMode="single"
      selectedKeys={selected ? [selected] : []}
      onAction={(k) => onPick(String(k))}
      renderEmptyState={() => <p className="tf-note">{empty}</p>}
    >
      {items.map((i) => (
        <ListBox.Item key={i.id} id={i.id} textValue={i.label} className="tf-list__row">
          {i.label}
          {selected === undefined ? null : <ListBox.ItemIndicator />}
        </ListBox.Item>
      ))}
    </ListBox>
  );
}
