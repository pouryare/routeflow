"use client";

import Link from "next/link";
import { Button, Card, ProgressBar } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { TUTORIALS, tutorialById } from "@/lib/tutorials/catalog";
import { firstSteps, isDone } from "@/lib/tutorials/engine";
import { faNum } from "@/lib/format";
import { useTutorials } from "./TutorialProvider";

/** «اولین قدم‌ها» at the top of the role's today page: the role's first jobs as a checklist, ticked by
 *  really finishing each tutorial, and any tutorial a manager sent (with their name, idea I7). Hides
 *  itself once everything is done; the badge then shows instead (idea I8). */
export default function FirstStepsCard() {
  const { role, progress, assignments, start } = useTutorials();
  if (!role) return null;
  const fs = firstSteps(role, progress, TUTORIALS);
  const sent = assignments.map((a) => ({ a, t: tutorialById(a.tutorial_id) })).filter((x) => x.t && !isDone(progress, x.t.id));
  const badge = BADGES[role];

  if (fs.complete && sent.length === 0) {
    return badge ? (
      <p className="tutbadge" role="status">
        <Icon name="star" size="sm" filled /> {badge}
      </p>
    ) : null;
  }
  if (fs.total === 0 && sent.length === 0) return null;

  return (
    <Card className="tutcard mb-3" data-tour="first-steps">
      <Card.Header className="tutcard__head">
        اولین قدم‌ها
        {fs.total > 0 ? (
          <span className="tutcard__count">
            {faNum(fs.done)} از {faNum(fs.total)}
          </span>
        ) : null}
      </Card.Header>
      <Card.Content>
        {fs.total > 0 ? (
          <ProgressBar aria-label="پیشرفت اولین قدم‌ها" value={fs.done} minValue={0} maxValue={fs.total} size="sm" className="mb-2">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : null}
        <ul className="tutlist">
          {sent.map(({ a, t }) => (
            <li key={`sent-${a.id}`} className="tutrow">
              <span className="tutrow__tick" aria-hidden>
                <Icon name="send" size="sm" />
              </span>
              <span className="tutrow__title">
                {t!.title}
                <small>{a.sent_by_name} فرستاده</small>
              </span>
              <span className="tutrow__actions">
                <Button size="sm" onPress={() => start(t!.id)}>
                  <Icon name="play" size="sm" /> شروع
                </Button>
              </span>
            </li>
          ))}
          {fs.items.map((t) => {
            const done = isDone(progress, t.id);
            return (
              <li key={t.id} className="tutrow">
                <span className={`tutrow__tick${done ? " on" : ""}`} aria-hidden>
                  <Icon name={done ? "check" : "dot"} size="sm" />
                </span>
                <span className="tutrow__title">{t.title}</span>
                {!done ? (
                  <span className="tutrow__actions">
                    <Button size="sm" variant="secondary" onPress={() => start(t.id)} aria-label={`شروع آموزش ${t.title}`}>
                      <Icon name="play" size="sm" /> شروع
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Link href="/settings/tutorials" className="tutcard__all">
          <Icon name="arrow-left" size="sm" /> همهٔ آموزش‌های برنامه
        </Link>
      </Card.Content>
    </Card>
  );
}

/** The badge a role earns when its first steps are all done (idea I8). */
export const BADGES: Partial<Record<string, string>> = {
  delivery_driver: "استاد مسیر",
  field_rep: "استاد مسیر",
  phone_sales: "استاد فروش",
  owner: "مدیر آماده",
  platform_owner: "مدیر آماده",
  group_manager: "سرپرست آماده",
  rep_manager: "سرپرست آماده",
};
