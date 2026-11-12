"use client";

import { FieldInput } from "@/components/FieldInput";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AcademyItem } from "@/lib/repo/academy";
import { faJalaliDate } from "@/lib/jalali";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { outcomeLabel } from "@/lib/tasks/labels";
import { CUSTOMER_TYPE_LABEL, type CustomerType } from "@/lib/types";
import { matchesQuery } from "@/lib/persian";

interface Card {
  id: number;
  outcome_code: string;
  customer_type: string | null;
  title_fa: string;
  script_fa: string;
}

/** /sales/academy as a learning path (item 23, the `onboarding` block family).
 *
 *  It was a flat list of modules with a «تمام کردم» button each and, below it, a wall of
 *  objection cards that printed their machine codes («PRICE_OBJECTION», «RESTAURANT»)
 *  beside Persian titles. Academy is a path, so it now reads as one: how far along you
 *  are, the next thing to do, the modules as numbered steps; then the objection library
 *  as expandable cards, labelled in Persian, searchable with the same normaliser as the
 *  rest of the app. */
export default function AcademyPath({ cards, items }: { cards: Card[]; items: AcademyItem[] }) {
  const [q, setQ] = useState("");

  const lessons = items.filter((i) => !i.draft);
  const doneCount = lessons.filter((i) => i.done).length;
  const next = lessons.find((i) => !i.done && i.required) ?? lessons.find((i) => !i.done) ?? null;
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0;
  // Shipped lessons first, then the company's categories, each heading once, in the order given.
  const sections = items.reduce<{ key: string; layer: AcademyItem["layer"]; category: string; rows: AcademyItem[] }[]>((acc, i) => {
    const key = `${i.layer}:${i.category}`;
    const sec = acc.find((x) => x.key === key);
    if (sec) sec.rows.push(i);
    else acc.push({ key, layer: i.layer, category: i.category, rows: [i] });
    return acc;
  }, []);

  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          !q.trim() ||
          matchesQuery(
            [c.title_fa, c.script_fa, outcomeLabel(c.outcome_code), c.customer_type ? CUSTOMER_TYPE_LABEL[c.customer_type as CustomerType] ?? "" : ""].join(" "),
            q,
          ),
      ),
    [cards, q],
  );

  return (
    <div className="acad" dir="rtl">
      <section className="acad__progress" aria-labelledby="acad-progress">
        <div className="acad__progress-text">
          <h3 id="acad-progress" className="sechead__title sechead__title--minor">
            مسیر یادگیری
          </h3>
          <p className="acad__muted">
            {lessons.length === 0
              ? "هنوز درسی تعریف نشده است."
              : `${faNum(doneCount)} از ${faNum(lessons.length)} درس خوانده شده`}
          </p>
          <div className="acad__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت در مسیر">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        {next ? (
          <div className="acad__next">
            <span className="acad__muted">{next.required ? "درس اجباری بعدی" : "درس بعدی"}</span>
            <b>{next.title}</b>
            <Link href={`/sales/academy/lesson/${next.slug}`} className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid">
              <Icon name="arrow-left" size="sm" /> بخوانید
            </Link>
          </div>
        ) : lessons.length > 0 ? (
          <div className="acad__next acad__next--done">
            <Icon name="flag" size="md" />
            <b>همهٔ درس‌ها را خوانده‌اید.</b>
          </div>
        ) : null}
      </section>

      {sections.map((sec) => (
        <section key={sec.key} aria-label={sec.category}>
          <h3 className="sechead__title sechead__title--minor">
            {sec.category} <span className="acad__chip acad__chip--quiet">{sec.layer === "routeflow" ? "RouteFlow" : "شرکت"}</span>
          </h3>
          <ol className="acad__steps">
            {sec.rows.map((m) => (
              <li key={m.slug} className={`acad__step${m.done ? " acad__step--done" : ""}${next?.slug === m.slug ? " acad__step--next" : ""}`}>
                <span className="acad__dot" aria-hidden="true">{m.done ? <Icon name="check" size="sm" /> : <Icon name="note" size="sm" />}</span>
                <Link href={`/sales/academy/lesson/${m.slug}`} className="acad__step-text">
                  <b>{m.title}</b>
                  {m.required && !m.done ? <span className="acad__chip">اجباری{m.dueOn ? ` تا ${faJalaliDate(m.dueOn)}` : ""}</span> : null}
                  {m.updated ? <span className="acad__chip">به‌روز شد</span> : null}
                  {m.draft ? <span className="acad__chip acad__chip--quiet">پیش‌نویس</span> : null}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <section className="acad__library" aria-labelledby="acad-library">
        <div className="acad__library-head">
          <h3 id="acad-library" className="sechead__title sechead__title--minor">
            پاسخ به مخالفت مشتری
          </h3>
          <label className="acad__search">
            <Icon name="search" size="sm" />
            <FieldInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در پاسخ‌ها…" aria-label="جستجو در پاسخ‌ها" />
          </label>
        </div>
        {filtered.length === 0 ? (
          <p className="acad__muted">پاسخی با این عبارت پیدا نشد.</p>
        ) : (
          <ul className="acad__cards">
            {filtered.map((c) => (
              <li key={c.id}>
                <details className="acard">
                  <summary>
                    <span className="acard__title">{c.title_fa}</span>
                    <span className="acad__chip">{outcomeLabel(c.outcome_code)}</span>
                    {c.customer_type ? (
                      <span className="acad__chip acad__chip--quiet">
                        {CUSTOMER_TYPE_LABEL[c.customer_type as CustomerType] ?? "همهٔ مشتری‌ها"}
                      </span>
                    ) : null}
                    <Icon name="chevron-down" size="sm" />
                  </summary>
                  <div className="acard__body">
                    <p>{c.script_fa}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
