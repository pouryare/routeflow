import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { labelCells } from "@/lib/tableCards";

type Part = ReactElement<{ children?: ReactNode }>;

/** The text of a header cell, or null when it is not plain text (a component has nothing to repeat). */
function plainText(node: ReactNode): string | null {
  const parts = Children.toArray(node);
  const text = parts.every((p) => typeof p === "string" || typeof p === "number") ? parts.join("").trim() : "";
  return text || null;
}

/** The column titles from the table's own `<thead>`, one per `<th>`. */
function headLabels(thead: Part | undefined): (string | null)[] {
  if (!thead) return [];
  const row = Children.toArray(thead.props.children).find(isValidElement) as Part | undefined;
  return Children.toArray(row?.props.children)
    .filter(isValidElement)
    .map((th) => plainText((th as Part).props.children));
}

/** A table on a desktop and one card per row on a phone, written as an ordinary `<table>`.
 *
 *  Tables are for desktop only (owner rule, 2026-10-30): below 768 px the same rows turn into
 *  cards, the first cell as the title and every other cell with its column's title in front of
 *  its value (`.acct-cards--tiles` in globals.css; `lib/tableCards`). Write `<CardTable>` where
 *  you would write `<table>`, with a plain `<thead>` and `<tbody>`; the titles come from the
 *  header. A header that is not plain text gives its cells no label. */
export default function CardTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  const parts = Children.toArray(children) as Part[];
  const head = headLabels(parts.find((p) => p.type === "thead"));
  return (
    <table className={`acct-cards acct-cards--tiles ${className}`.trim()}>
      {parts.map((p) =>
        p.type === "tbody" || p.type === "tfoot" ? cloneElement(p, undefined, labelCells(p.props.children, head)) : p,
      )}
    </table>
  );
}
