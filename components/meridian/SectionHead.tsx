/** A section's heading: title, an optional line beneath it, optional actions at the end.
 *
 *  Item 15 was «سفارش‌های بدون مسیر» and «مسیرهای باز» side by side with different
 *  headings: one 15px medium with its hint below, one without, different gaps. Every page
 *  had hand-rolled its own, so no two sections in the app agreed; a sweep found thirty-odd
 *  in at least five sizes and three weights. This is the one heading. Its title shares a
 *  rule with a card's `.bhead h2`, so a section outside a card and one inside it read as
 *  the same thing. tests/section-headings.test.ts refuses a hand-styled heading.
 *
 *  `as="h3"` for a heading one level down (a sub-list inside a section). Server-safe: no
 *  state, no effects, so client and server components both use it.
 */
export default function SectionHead({
  title,
  sub,
  actions,
  as: Tag = "h2",
  id,
  className = "",
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3";
  id?: string;
  className?: string;
}) {
  return (
    <div className={`sechead ${Tag === "h3" ? "sechead--minor" : ""} ${className}`.trim()}>
      <div className="sechead__text">
        <Tag id={id} className="sechead__title">
          {title}
        </Tag>
        {sub ? <p className="sechead__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="sechead__actions">{actions}</div> : null}
    </div>
  );
}
