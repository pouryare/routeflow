"use client";

import { CardHelp } from "@/components/meridian/CardHelp";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import WhyDrilldown, { type Rung } from "./WhyDrilldown";
import Sparkline from "@/components/charts/Sparkline";
import { Icon } from "@/components/meridian/Icon";
import { DUR, EASE } from "@/lib/motion";
import KpiCarousel from "@/components/mobile/KpiCarousel";
import DrillSheet from "@/components/mobile/DrillSheet";
import { useIsNarrow } from "@/lib/useIsNarrow";
import { formatKpi, kpiDelta } from "@/lib/kpiCards";

export interface KpiCard {
  metric: string;
  title_fa: string;
  value: number | null;
  prev_value: number | null;
  target: number | null;
  direction: "up" | "down";
  definition_fa: string;
  action_fa: string;
  delta_pct: number;
  on_track: boolean;
  sample_size: number | null;
}

const WHYABLE = new Set(["net_sales", "gross_profit", "orders"]);
/** The metric that leads the section, large. Net sales is the number the owner opens the
 *  page for; the rest explain it. */
const HERO = "net_sales";

const show = formatKpi;

/** The change against last period, as a chip with an icon AND a colour (the colour alone
 *  fails for anyone who cannot tell the two hues apart, and on paper). Good or bad follows
 *  the metric's own direction: a rising return rate is not good news. */
function DeltaChip({ c }: { c: KpiCard }) {
  const d = kpiDelta(c);
  if (!d) return null;
  return (
    <span className={`kpichip kpichip--${d.good === null ? "flat" : d.good ? "good" : "bad"}`}>
      <Icon name={d.dir === "flat" ? "dot" : d.dir === "up" ? "arrow-up" : "arrow-down"} size="sm" />
      {d.text}
    </span>
  );
}

/** Item 10: «شاخص‌های کلیدی» as one instrument.
 *
 *  It was a grid of loose bordered tiles, each with a «ⓘ» glyph, which read as a dozen
 *  unrelated numbers. Now: the headline metric as a hero card with its trend, the rest as
 *  one connected bar (`stats-connected-kpi-bar-with-trends`) with a sparkline and a
 *  change chip per segment, and a segment expands its definition, the suggested action
 *  and the «چرا؟» drill-down underneath (the expandable card the user pointed at).
 *
 *  `trends` is metric → recent periods, oldest FIRST as kpiHistory returns them; reversed
 *  here into Sparkline's oldest-last. */
export default function KpiStrip({
  cards,
  period,
  trends = {},
}: {
  cards: KpiCard[];
  period: string;
  trends?: Record<string, (number | null)[]>;
}) {
  const reduce = useReducedMotion();
  const narrow = useIsNarrow();
  const [open, setOpen] = useState<string | null>(null);
  const [why, setWhy] = useState<Record<string, Rung[] | "loading">>({});

  async function loadWhy(metric: string) {
    if (why[metric]) {
      setWhy((w) => {
        const n = { ...w };
        delete n[metric];
        return n;
      });
      return;
    }
    setWhy((w) => ({ ...w, [metric]: "loading" }));
    const res = await fetch(`/api/analysis/why?metric=${metric}&to=${period}`);
    const j = await res.json();
    setWhy((w) => ({ ...w, [metric]: j.ok ? (j.chain as Rung[]) : [] }));
  }

  const series = (metric: string) => [...(trends[metric] ?? [])].reverse();
  const toggle = (metric: string) => setOpen((m) => (m === metric ? null : metric));
  const hero = cards.find((c) => c.metric === HERO) ?? cards[0];
  const rest = cards.filter((c) => c !== hero);
  const detail = cards.find((c) => c.metric === open) ?? null;

  const detailBody = detail ? (
    <>
      <h3 className="sechead__title sechead__title--minor">{detail.title_fa}</h3>
      {detail.definition_fa ? <p>{detail.definition_fa}</p> : null}
      {detail.action_fa ? <p className="kpibar__action">{detail.action_fa}</p> : null}
      {WHYABLE.has(detail.metric) ? (
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => loadWhy(detail.metric)}>
          <Icon name="help" size="sm" /> چرا؟
        </button>
      ) : null}
      {why[detail.metric] === "loading" ? <p className="kpibar__action">در حال محاسبه…</p> : null}
      {Array.isArray(why[detail.metric]) ? <WhyDrilldown chain={why[detail.metric] as Rung[]} /> : null}
    </>
  ) : null;

  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <div>
          <h2>شاخص‌های کلیدی</h2>
          <div className="n">روی هر شاخص بزنید تا تعریفش، کار پیشنهادی و «چرا؟» باز شود.</div>
        </div>
        <CardHelp id="card.kpi" />
      </div>
      <div className="kblock__body">
        {hero ? (
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] kpihero"
            aria-expanded={open === hero.metric}
            aria-controls="kpi-detail"
            onClick={() => toggle(hero.metric)}
          >
            <Icon name="chart" size="md" />
            <span className="kpihero__text">
              <span className="kpihero__k">{hero.title_fa}</span>
              <span className={`kpihero__v${hero.value !== null && !hero.on_track ? " kpibar__v--off" : ""}`}>
                {show(hero.metric, hero.value)}
              </span>
              <span className="kpihero__row">
                <DeltaChip c={hero} />
                {hero.prev_value !== null ? <span>ماه قبل {show(hero.metric, hero.prev_value)}</span> : null}
                {hero.target !== null ? <span>هدف {show(hero.metric, hero.target)}</span> : null}
              </span>
              {hero.target !== null && hero.value !== null && hero.target > 0 ? (
                <span className="kpihero__goal" aria-label="پیشرفت تا هدف">
                  <span style={{ width: `${Math.min(100, (hero.value / hero.target) * 100)}%` }} />
                </span>
              ) : null}
            </span>
            <Sparkline values={series(hero.metric)} height={64} area />
          </button>
        ) : null}

        <div className="kpibar">
          {rest.map((c) => (
            <button
              key={c.metric}
              type="button"
              className="inline-flex items-center justify-center gap-[var(--space-2)] kpibar__seg"
              aria-expanded={open === c.metric}
              aria-controls="kpi-detail"
              onClick={() => toggle(c.metric)}
            >
              <Icon name="target" size="md" />
              <span className="kpibar__k">{c.title_fa}</span>
              <span className={`kpibar__v${c.value !== null && !c.on_track ? " kpibar__v--off" : ""}`}>
                {show(c.metric, c.value)}
              </span>
              <span className="kpibar__meta">
                <DeltaChip c={c} />
                {c.target !== null ? <span>هدف {show(c.metric, c.target)}</span> : null}
                {c.sample_size !== null && c.sample_size < 5 ? <span>نمونهٔ کم</span> : null}
              </span>
              <Sparkline values={series(c.metric)} height={22} />
            </button>
          ))}
        </div>

        <KpiCarousel
          ariaLabel="شاخص‌های کلیدی"
          onOpen={toggle}
          cards={rest.map((c) => ({
            id: c.metric,
            label: `${c.title_fa}: ${show(c.metric, c.value)}`,
            body: (
              <>
                <span className="kpibar__k">{c.title_fa}</span>
                <span className={`kpibar__v${c.value !== null && !c.on_track ? " kpibar__v--off" : ""}`}>{show(c.metric, c.value)}</span>
                <span className="kpibar__meta">
                  <DeltaChip c={c} />
                  {c.target !== null ? <span>هدف {show(c.metric, c.target)}</span> : null}
                </span>
                <Sparkline values={series(c.metric)} height={28} />
              </>
            ),
          }))}
        />
        {/* On a phone the breakdown opens in a sheet over the cards; from 768px it unfolds
            under the bar as before (the bar and its detail are hidden below that by CSS). */}
        <DrillSheet open={narrow && detail !== null} title={detail?.title_fa ?? ""} onClose={() => setOpen(null)}>
          {detailBody}
        </DrillSheet>

        <AnimatePresence initial={false}>
          {detail ? (
            <motion.div
              key={detail.metric}
              id="kpi-detail"
              className="kpibar__detail"
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: reduce ? 0 : DUR.base, ease: EASE.out }}
            >
              {detailBody}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
