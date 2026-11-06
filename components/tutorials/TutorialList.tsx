"use client";

import { useMemo, useState } from "react";
import { Button, Card } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { AnswerSearch } from "@/components/tapflow/Answer";
import { TUTORIALS } from "@/lib/tutorials/catalog";
import { firstSteps, isDone, searchTutorials, tutorialsFor } from "@/lib/tutorials/engine";
import { faNum } from "@/lib/format";
import type { Tutorial } from "@/lib/tutorials/types";
import { useTutorials } from "./TutorialProvider";

/** The «آموزش برنامه» list: «اولین قدم‌ها» first with how far the person is, then every other tutorial.
 *  «ببین» runs it with hints (and the ghost hand for longer jobs); a finished one also offers «تمرین»,
 *  the same job on fresh demo data with no hints and no timer (idea I9). */
export default function TutorialList() {
  const { role, progress, start } = useTutorials();
  const [q, setQ] = useState("");
  const all = useMemo(() => (role ? tutorialsFor(role, TUTORIALS) : []), [role]);
  const found = useMemo(() => (role && q.trim() ? searchTutorials(q, role, TUTORIALS) : null), [q, role]);

  if (!role) return <p className="tf-empty">در حال بارگذاری آموزش‌ها…</p>;
  if (all.length === 0) return <p className="tf-empty">برای نقش شما هنوز آموزشی نوشته نشده است.</p>;

  const fs = firstSteps(role, progress, TUTORIALS);
  const rest = all.filter((t) => !t.firstSteps);

  const row = (t: Tutorial) => {
    const done = isDone(progress, t.id);
    return (
      <li key={t.id} className="tutrow">
        <span className={`tutrow__tick${done ? " on" : ""}`} aria-hidden>
          <Icon name={done ? "check" : "dot"} size="sm" />
        </span>
        <span className="tutrow__title">
          {t.title}
          <small>{faNum(t.steps.length)} قدم{done ? " · انجام شده" : ""}</small>
        </span>
        <span className="tutrow__actions">
          <Button size="sm" onPress={() => start(t.id)} aria-label={`نمایش آموزش ${t.title}`}>
            <Icon name="play" size="sm" /> ببین
          </Button>
          {done ? (
            <Button size="sm" variant="secondary" onPress={() => start(t.id, "practice")} aria-label={`تمرین ${t.title}`}>
              <Icon name="repeat" size="sm" /> تمرین
            </Button>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <AnswerSearch value={q} onChange={setQ} label="جستجوی آموزش" placeholder="چطور… (مثلاً: ثبت چک)" />
      {found ? (
        <Card className="tutcard">
          <Card.Header className="tutcard__head">نتیجهٔ جستجو</Card.Header>
          <Card.Content>{found.length ? <ul className="tutlist">{found.map(row)}</ul> : <p className="tf-empty">آموزشی با این کلمه پیدا نشد. کلمهٔ ساده‌تری بنویسید.</p>}</Card.Content>
        </Card>
      ) : (
        <>
          {fs.total > 0 ? (
            <Card className="tutcard">
              <Card.Header className="tutcard__head">
                اولین قدم‌ها
                <span className="tutcard__count">
                  {faNum(fs.done)} از {faNum(fs.total)}
                </span>
              </Card.Header>
              <Card.Content>
                <ul className="tutlist">{fs.items.map(row)}</ul>
              </Card.Content>
            </Card>
          ) : null}
          {rest.length > 0 ? (
            <Card className="tutcard">
              <Card.Header className="tutcard__head">همهٔ آموزش‌های برنامه</Card.Header>
              <Card.Content>
                <ul className="tutlist">{rest.map(row)}</ul>
              </Card.Content>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
