"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import SmartPicker from "@/components/mobile/SmartPicker";
import { useToast } from "@/components/ToastProvider";
import { TUTORIALS, tutorialById } from "@/lib/tutorials/catalog";
import { tutorialsFor } from "@/lib/tutorials/engine";
import { faNum } from "@/lib/format";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import type { StepCount } from "@/lib/repo/tutorials";

type Person = { id: number; name: string; role: string };
type Sent = { id: number; user_id: number; user_name: string; tutorial_id: string; sent_at: string; seen_at: string | null; done_at: string | null };

/** Idea I7 and I12, on the «آموزش برنامه» page for managers and owners: send one tutorial to one
 *  person and read back sent, seen and done; the owner also reads how many started, finished,
 *  skipped or quit each tutorial (counts only, no names). */
export default function TutorSection({ people, sent, counts }: { people: Person[]; sent: Sent[]; counts: StepCount[] | null }) {
  const router = useRouter();
  const toast = useToast();
  const [who, setWho] = useState("");
  const [which, setWhich] = useState("");
  const [busy, setBusy] = useState(false);
  const person = people.find((p) => String(p.id) === who);
  const options = useMemo(
    () => (person ? tutorialsFor(person.role as Role, TUTORIALS).filter((t) => !t.autoStart).map((t) => ({ id: t.id, label: t.title })) : []),
    [person],
  );

  async function send() {
    if (!person || !which) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tutorials/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: person.id, tutorial_id: which }) });
      if (!res.ok) throw new Error();
      toast(`آموزش برای ${person.name} فرستاده شد`, "success");
      setWhich("");
      router.refresh();
    } catch {
      toast("فرستادن آموزش نشد. دوباره امتحان کنید.", "error");
    } finally {
      setBusy(false);
    }
  }

  const status = (s: Sent) => (s.done_at ? "انجام شد" : s.seen_at ? "دیده شد" : "فرستاده شد");

  const byTutorial = useMemo(() => {
    const m = new Map<string, { start: number; done: number; skip: number; quit: number; worst: number }>();
    const quitAt = new Map<string, number>();
    for (const c of counts ?? []) {
      const e = m.get(c.tutorial_id) ?? { start: 0, done: 0, skip: 0, quit: 0, worst: -1 };
      e[c.event] += c.n;
      if (c.event === "quit" && c.n > (quitAt.get(c.tutorial_id) ?? 0)) {
        quitAt.set(c.tutorial_id, c.n);
        e.worst = c.step;
      }
      m.set(c.tutorial_id, e);
    }
    return [...m.entries()].filter(([id]) => tutorialById(id));
  }, [counts]);

  return (
    <>
      <Card className="tutcard">
        <Card.Header>
          <Card.Title>فرستادن آموزش به همکار</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-[var(--space-3)]">
          <SmartPicker scope="tutorial-people" label="همکار" items={people.map((p) => ({ id: String(p.id), label: `${p.name} · ${ROLE_LABEL[p.role as Role] ?? p.role}` }))} value={who} onChange={(id) => { setWho(id); setWhich(""); }} placeholder="کدام همکار؟" />
          {person ? <SmartPicker scope="tutorial-which" label="آموزش" items={options} value={which} onChange={setWhich} placeholder="کدام آموزش؟" /> : null}
          <Button isDisabled={!person || !which || busy} onPress={() => void send()}>
            <Icon name="send" size="md" /> فرستادن
          </Button>
          <p className="tf-sub">همکار آن را روی صفحهٔ امروزش با نام شما می‌بیند.</p>
        </Card.Content>
      </Card>

      {sent.length > 0 ? (
        <Card className="tutcard">
          <Card.Header>
            <Card.Title>آموزش‌هایی که فرستاده‌اید</Card.Title>
          </Card.Header>
          <Card.Content>
            <ul className="tutlist">
              {sent.slice(0, 30).map((s) => (
                <li key={s.id} className="tutrow">
                  <span className="tutrow__title">
                    {s.user_name} · {tutorialById(s.tutorial_id)?.title ?? s.tutorial_id}
                    <small>{status(s)}</small>
                  </span>
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}

      {counts ? (
        <Card className="tutcard">
          <Card.Header>
            <Card.Title>آموزش‌ها در شرکت شما</Card.Title>
          </Card.Header>
          <Card.Content>
            {byTutorial.length === 0 ? (
              <p className="tf-sub">هنوز کسی آموزشی را شروع نکرده است. اینجا فقط تعداد می‌بینید، بدون نام.</p>
            ) : (
              <ul className="tutlist">
                {byTutorial.map(([id, e]) => (
                  <li key={id} className="tutrow">
                    <span className="tutrow__title">
                      {tutorialById(id)?.title}
                      <small>
                        شروع {faNum(e.start)} · تمام {faNum(e.done)} · ردکردن {faNum(e.skip)} · نیمه‌رها {faNum(e.quit)}
                        {e.worst >= 0 && e.quit > 0 ? ` (بیشتر در قدم ${faNum(e.worst + 1)})` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card.Content>
        </Card>
      ) : null}
    </>
  );
}
