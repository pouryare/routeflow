"use client";

import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { Worklist, WorkReminder } from "@/lib/mapWorklist";
import type { CustomerRow, DistrictProperties } from "@/lib/types";

/** «در این محدوده»: the top of the map sidebar when nothing is selected (item 27).
 *
 *  Three short lists of work in the area on screen, rewritten as the map moves. Each row
 *  opens its record on the map, so the sidebar leads somewhere instead of repeating the
 *  navigation bar. Lists are capped; the heading carries the true count, so a cap never
 *  hides how much there is. The rules are lib/mapWorklist.ts. */
export default function MapWorklist({
  worklist,
  onCustomer,
  onDistrict,
  onReminder,
}: {
  worklist: Worklist & { totals: { quiet: number; reminders: number; uncovered: number } };
  onCustomer: (c: CustomerRow) => void;
  onDistrict: (d: DistrictProperties) => void;
  onReminder: (r: WorkReminder) => void;
}) {
  const { quiet, reminders, uncovered, totals } = worklist;
  const nothing = totals.quiet + totals.reminders + totals.uncovered === 0;

  return (
    <section className="mwork" aria-labelledby="mwork-heading">
      <div className="mwork__head">
        <Icon name="target" size="sm" />
        <h2 id="mwork-heading" className="sechead__title sechead__title--minor">
          در این محدوده
        </h2>
      </div>
      {nothing ? (
        <p className="mwork__none">در بخشی از نقشه که می‌بینید کاری معوق نیست. نقشه را جابه‌جا کنید تا فهرست به‌روز شود.</p>
      ) : (
        <>
          {totals.reminders > 0 ? (
            <div className="mwork__group">
              <h3 className="sechead__title sechead__title--minor mwork__label">
                یادآوری سررسیده <span className="mwork__n">{faNum(totals.reminders)}</span>
              </h3>
              <ul className="mwork__list">
                {reminders.map((r) => (
                  <li key={`r${r.id}`}>
                    <button type="button" className="mwork__row" onClick={() => onReminder(r)}>
                      <Icon name="bell" size="sm" />
                      <span className="mwork__text">
                        <span className="mwork__title">{r.label}</span>
                        {r.message ? <span className="mwork__sub">{r.message}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {totals.quiet > 0 ? (
            <div className="mwork__group">
              <h3 className="sechead__title sechead__title--minor mwork__label">
                مشتریان بی‌خرید <span className="mwork__n">{faNum(totals.quiet)}</span>
              </h3>
              <ul className="mwork__list">
                {quiet.map(({ customer, days }) => (
                  <li key={`c${customer.id}`}>
                    <button type="button" className="mwork__row" onClick={() => onCustomer(customer)}>
                      <Icon name="building" size="sm" />
                      <span className="mwork__text">
                        <span className="mwork__title">{customer.business_name}</span>
                        <span className="mwork__sub">
                          {days === null ? "غیرفعال علامت خورده" : `${faNum(days)} روز بدون خرید`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {totals.uncovered > 0 ? (
            <div className="mwork__group">
              <h3 className="sechead__title sechead__title--minor mwork__label">
                مناطق بی‌پوشش <span className="mwork__n">{faNum(totals.uncovered)}</span>
              </h3>
              <ul className="mwork__list">
                {uncovered.map((d) => (
                  <li key={`d${d.id}`}>
                    <button type="button" className="mwork__row" onClick={() => onDistrict(d)}>
                      <Icon name="map" size="sm" />
                      <span className="mwork__text">
                        <span className="mwork__title">{d.name}</span>
                        {d.parent_name ? <span className="mwork__sub">{d.parent_name}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
