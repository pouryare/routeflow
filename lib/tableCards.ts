import { Children, cloneElement, isValidElement, Fragment, type ReactElement, type ReactNode } from "react";

/** A wide table that turns into one card per row on a phone, from the SAME markup.
 *
 *  The pages write ordinary `<tr><td>` rows; here each cell gets a `data-label` copied from its
 *  column's header, and CSS (`.acct-cards` in globals.css) lays the row out as a card with the
 *  label in front of each value. The first cell is the card's title and carries no label. Nothing
 *  about the page changes, and from 768px up it is still a table.
 *
 *  Only string headers become labels (a header that is a component has no text to repeat), and a
 *  cell with `colSpan` skips the columns it covers so later cells keep their own labels. */
export function labelCells(children: ReactNode, head: readonly ReactNode[]): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const el = child as ReactElement<{ children?: ReactNode; colSpan?: number }>;
    if (el.type === Fragment) return cloneElement(el, undefined, labelCells(el.props.children, head));
    if (el.type !== "tr") return child;

    let col = 0;
    const cells = Children.map(el.props.children, (cell) => {
      if (!isValidElement(cell)) return cell;
      const c = cell as ReactElement<{ colSpan?: number }>;
      const at = col;
      col += c.props.colSpan ?? 1;
      const h = head[at];
      return at > 0 && typeof h === "string" ? cloneElement(c, { "data-label": h } as object) : cell;
    });
    return cloneElement(el, undefined, cells);
  });
}
