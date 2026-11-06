"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Card } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { useTutorials } from "./context";
import { playVoice, stopVoice } from "./voice";
import { fxOn, useSpotlight } from "./spotlight";

/** One card per step: the provider keys it by tutorial, mode and step, so every step starts fresh.
 *
 *  The tutorial's card at the bottom of the screen, in the thumb zone, and the spotlight on the
 *  button it is about.
 *
 *  driver.js draws only the dim and the hole (its own bubble is never used); the words, buttons,
 *  sounds and right-to-left order are ours. A step waits for the real tap on its button. A step
 *  whose button is not on the screen turns into a plain card with «ادامه», or «برو» when it lives
 *  on another page, so nobody is trapped. In practice mode the card hides its hints until asked. */

const FIND_MS = 4000;

export default function TourCard() {
  const { active, next, stop, toLearn } = useTutorials();
  const router = useRouter();
  const pathname = usePathname();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [missing, setMissing] = useState(false);
  const [hint, setHint] = useState(false);
  const [hand, setHand] = useState<{ x: number; y: number } | null>(null);

  const step = active ? active.t.steps[active.i] : undefined;
  const mode = active?.mode ?? "learn";
  const showHints = mode !== "practice" || hint;

  /* Find the step's button, waiting a moment for a page or sheet to open. */
  useEffect(() => {
    if (!step?.target) return;
    const sel = `[data-tour="${step.target}"]`;
    const t0 = Date.now();
    let timer = 0;
    const look = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((n) => n.getClientRects().length > 0);
      if (found) {
        setMissing(false);
        setEl(found);
        return;
      }
      if (Date.now() - t0 > FIND_MS) return setMissing(true);
      timer = window.setTimeout(look, 150);
    };
    timer = window.setTimeout(look, 0);
    return () => window.clearTimeout(timer);
  }, [step?.target, pathname]);

  useSpotlight(el, showHints, setHand);

  /* A real tap on the button moves the tutorial on. */
  useEffect(() => {
    if (!step?.target || (step.advance ?? "tap") !== "tap" || mode === "ghost") return;
    const sel = `[data-tour="${step.target}"]`;
    const onTap = (e: Event) => {
      /* Only a press on a button or link inside the target counts: typing in a pick step's search
         box must not move the tutorial on. */
      const hit = (e.target as Element | null)?.closest?.("button, a, [role=button], [role=option], [role=row], label");
      if (hit?.closest(sel)) window.setTimeout(next, 250);
    };
    const onSlide = (e: Event) => {
      if ((e as CustomEvent<string>).detail === step.target) window.setTimeout(next, 250);
    };
    document.addEventListener("click", onTap, true);
    window.addEventListener("rf-tour", onSlide);
    return () => {
      document.removeEventListener("click", onTap, true);
      window.removeEventListener("rf-tour", onSlide);
    };
  }, [step?.target, step?.advance, mode, next]);

  /* The ghost hand plays the job: it glides to each button and taps it (saves are pretend). */
  useEffect(() => {
    if (mode !== "ghost") return;
    if (missing) {
      const id = window.setTimeout(next, 1200);
      return () => window.clearTimeout(id);
    }
    if (!el && step?.target) return;
    const id = window.setTimeout(() => {
      if (el && (step?.advance ?? "tap") === "tap") {
        // A whole step (a pick list) is the target: the hand presses its first answer.
        const press = el.matches("button, a, [role=button]") ? el : el.querySelector<HTMLElement>("button:not([disabled]), a");
        press?.click();
      }
      next();
    }, 1800);
    return () => window.clearTimeout(id);
  }, [mode, el, missing, step, next]);

  /* The voice reads the step, when sound is on. */
  useEffect(() => {
    if (!active || !showHints) return;
    playVoice(active.t.id, active.i);
    return () => stopVoice();
  }, [active?.t.id, active?.i, showHints, active]);

  if (!active || !step) return null;

  const total = active.t.steps.length;
  const elsewhere = missing && step.path && pathname !== step.path;
  const waitsForTap = !!step.target && (step.advance ?? "tap") === "tap" && !missing;
  const title = mode === "ghost" ? `ببینید: ${active.t.title}` : mode === "practice" ? `تمرین: ${active.t.title}` : active.t.title;

  return (
    <>
      {hand && showHints && fxOn() ? (
        <span className="tourhand" data-react-aria-top-layer="true" style={{ left: hand.x, top: hand.y }} aria-hidden data-tap={mode === "ghost" ? "auto" : "hint"}>
          <Icon name="navigation" size="lg" />
        </span>
      ) : null}
      <div className="tourcard-wrap" data-react-aria-top-layer="true" data-at={hand && hand.y > window.innerHeight * 0.55 ? "top" : "bottom"} role="dialog" aria-live="polite" aria-label={`آموزش: ${active.t.title}`}>
        <Card className="tourcard">
          <Card.Header className="tourcard__head">
            <span className="tourcard__title">{title}</span>
            <span className="tourcard__count">
              {faNum(active.i + 1)} از {faNum(total)}
            </span>
          </Card.Header>
          <Card.Content className="tourcard__body">
            {showHints ? <p className="tourcard__text">{active.shown && active.i === 0 ? `حالا شما: ${step.text}` : step.text}</p> : <p className="tourcard__text tourcard__text--muted">بدون راهنما انجامش دهید.</p>}
            {missing && !elsewhere ? <p className="tourcard__note">این دکمه الان روی صفحه نیست. «ادامه» را بزنید.</p> : null}
          </Card.Content>
          <Card.Footer className="tourcard__foot">
            {elsewhere ? (
              <Button className="tourcard__go" onPress={() => router.push(step.path!)}>
                <Icon name="arrow-left" size="sm" /> برو
              </Button>
            ) : !waitsForTap && mode !== "ghost" ? (
              <Button className="tourcard__go" onPress={next}>
                <Icon name="arrow-left" size="sm" /> {active.i + 1 === total ? "تمام" : "ادامه"}
              </Button>
            ) : null}
            {mode === "practice" && !hint ? (
              <Button variant="secondary" onPress={() => setHint(true)}>
                <Icon name="help" size="sm" /> راهنما
              </Button>
            ) : null}
            {mode === "ghost" ? (
              <Button variant="secondary" onPress={toLearn}>
                <Icon name="play" size="sm" /> خودم انجام می‌دهم
              </Button>
            ) : null}
            <Button variant="ghost" onPress={() => stop(active.i === 0 && !active.shown ? "skip" : "quit")}>
              <Icon name="x" size="sm" /> بعداً
            </Button>
          </Card.Footer>
        </Card>
      </div>
    </>
  );
}
