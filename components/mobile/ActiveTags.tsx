"use client";

import { Tag, TagGroup } from "@heroui/react";

/** What a filter is currently narrowing by, as removable tags under the chips, so the state
 *  reads without opening anything and one tap on a tag's × takes it off. */
export default function ActiveTags({ label, items, onRemove }: {
  label: string;
  items: { id: string; label: string }[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <TagGroup aria-label={label} size="md" onRemove={(keys) => keys.forEach((k) => onRemove(String(k)))}>
      <TagGroup.List className="activetags">
        {items.map((i) => (
          <Tag key={i.id} id={i.id} textValue={i.label}>
            {i.label}
            <Tag.RemoveButton aria-label={`برداشتن ${i.label}`} />
          </Tag>
        ))}
      </TagGroup.List>
    </TagGroup>
  );
}
