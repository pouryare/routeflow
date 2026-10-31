"use client";

import type { ReactNode } from "react";
import { Button, Link, ListBox, SearchField, ToggleButton, buttonVariants } from "@heroui/react";
import { Icon, type IconName } from "@/components/meridian/Icon";
import { useRepeatPress } from "./useRepeatPress";

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
  repeat,
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
  /** Holding the button repeats `onPress` (a count up or down); a tap is still one press. */
  repeat?: boolean;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const held = useRepeatPress(onPress);
  const cls = `tf-opt${tone ? ` ${tone}` : ""}${selected ? " on" : ""}${className ? ` ${className}` : ""}`;
  const body = (
    <>
      {icon ? <Icon name={icon} size="md" /> : null}
      {children}
    </>
  );
  if (selected === undefined) {
    return (
      <Button variant="secondary" className={cls} isDisabled={isDisabled} aria-label={ariaLabel} {...(repeat ? held : { onPress })}>
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
export function SkipButton({ icon = "arrow-left", isDisabled, onPress, children }: { icon?: IconName; isDisabled?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" className="tf-skip" isDisabled={isDisabled} onPress={onPress}>
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

/** The one confirming button under an answer step: HeroUI's primary Button at the 52 px answer
 *  size, full width. Used where a step has typed or chosen something and needs «ادامه». */
export function GoButton({ icon = "check", isDisabled, onPress, children }: { icon?: IconName; isDisabled?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Button variant="primary" size="lg" fullWidth className="tf-go" isDisabled={isDisabled} onPress={onPress}>
      {icon ? <Icon name={icon} size="md" /> : null}
      {children}
    </Button>
  );
}

/** An answer that is a page: HeroUI's Link wearing the secondary Button look and the `tf-opt`
 *  card shape, so the «بیشتر» menu rows match the answers around them. Client navigation goes
 *  through HeroUIProvider's RouterProvider. */
export function AnswerLink({ href, icon, onPress, children }: { href: string; icon?: IconName; onPress?: () => void; children: ReactNode }) {
  return (
    <Link href={href} onPress={onPress} className={`${buttonVariants({ variant: "secondary" })} tf-opt`}>
      {icon ? <Icon name={icon} size="md" /> : null}
      {children}
    </Link>
  );
}
