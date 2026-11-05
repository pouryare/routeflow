"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Drawer } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import WidgetBoundary from "@/components/WidgetBoundary";
import { playSound } from "@/lib/sound";
import { useBackToClose } from "@/lib/useBackToClose";
import { haptic } from "@/lib/haptics";
import { rubberBand, stretchAllowed, TAP_PX } from "@/lib/sheetStops";

/** Pulling a sheet up by its handle or header (native listeners on the dialog, which HeroUI
 *  captures the pointer on, and whose own props would replace HeroUI's):
 *  - a half-height sheet grows to full (`onGrow`);
 *  - a sheet that cannot grow any more stretches a little and springs back on release, the rubber
 *    band (lib/sheetStops.ts), unless effects are off.
 *  An upward move never reaches HeroUI, which would otherwise read a quick pull up as a flick and
 *  close the sheet; its drag down to dismiss is untouched. Returns the handle's ref and the last
 *  gesture's upward pull, so the handle can tell a tap from a pull. */
function usePullUp(atMax: boolean, onGrow: () => void) {
  const latest = useRef({ atMax, onGrow });
  useEffect(() => { latest.current = { atMax, onGrow }; });
  const lastPull = useRef(0);
  const ref = useCallback((handle: HTMLDivElement | null) => {
    const dialog = handle?.closest<HTMLElement>("[data-slot='drawer-dialog']");
    if (!dialog) return;
    let from: number | null = null;
    let grew = false;
    let startHeight = 0;
    let stretched = false;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      from = null;
      lastPull.current = 0;
      if (!t.closest("[data-slot='drawer-handle'], [data-slot='drawer-header']")) return;
      if (t.closest("input, textarea, button, [role='button'], select, a")) return;
      from = e.clientY;
      grew = false;
      startHeight = dialog.offsetHeight;
    };
    const move = (e: PointerEvent) => {
      if (from === null) return;
      const pull = from - e.clientY;
      lastPull.current = Math.max(lastPull.current, pull);
      if (pull <= 0 && !stretched) return;
      e.stopPropagation();
      if (pull <= TAP_PX) return;
      if (!dialog.hasPointerCapture(e.pointerId)) dialog.setPointerCapture(e.pointerId);
      if (!latest.current.atMax) {
        if (!grew) { grew = true; latest.current.onGrow(); }
        return;
      }
      if (grew || !stretchAllowed()) return;
      stretched = true;
      dialog.style.transition = "none";
      dialog.style.maxHeight = "none";
      dialog.style.height = `${startHeight + rubberBand(Math.max(0, pull))}px`;
    };
    const up = () => {
      from = null;
      if (!stretched) return;
      stretched = false;
      playSound("sheet.settle");
      dialog.style.transition = "height 300ms var(--spring-snap)";
      dialog.style.height = `${startHeight}px`;
      dialog.addEventListener("transitionend", () => {
        dialog.style.transition = "";
        dialog.style.height = "";
        dialog.style.maxHeight = "";
      }, { once: true });
    };
    dialog.addEventListener("pointerdown", down);
    dialog.addEventListener("pointermove", move);
    dialog.addEventListener("pointerup", up);
    dialog.addEventListener("pointercancel", up);
    return () => {
      dialog.removeEventListener("pointerdown", down);
      dialog.removeEventListener("pointermove", move);
      dialog.removeEventListener("pointerup", up);
      dialog.removeEventListener("pointercancel", up);
    };
  }, []);
  return [ref, lastPull] as const;
}

export default function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  closeLabel,
  bodyClassName = "tapflow",
  live = false,
  wide = false,
  dirty = false,
  expandable = false,
  children,
}: {
  open: boolean;
  title: ReactNode;
  /** One line under the title: a customer's place, a flow's subject. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** Says what closes: «بستن فیلترها», never a bare «بستن» (docs/copy-audit). */
  closeLabel: string;
  bodyClassName?: string;
  /** For a body whose content replaces itself (a tap flow's next question). */
  live?: boolean;
  /** Room for a map: the sheet widens past the 640 px column on a large screen. */
  wide?: boolean;
  /** The body holds input that closing would throw away: closing asks first, and drag-down
   *  and a backdrop tap stop closing until it is saved or discarded. */
  dirty?: boolean;
  /** A long list: open at half height, full height on demand. */
  expandable?: boolean;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Reset with each opening, during render rather than in an effect, so a sheet never reopens
  // still asking or still expanded from last time.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setAsking(false); setExpanded(false); }
  }

  useEffect(() => { if (open) haptic("light"); }, [open]);

  /** Every way of closing comes through here. false = stayed open to ask about unsaved input. */
  const requestClose = (): boolean => {
    if (dirty && !asking) {
      setAsking(true);
      haptic("selection");
      return false;
    }
    onClose();
    return true;
  };
  useBackToClose(open, requestClose);

  // Pull the handle or header up to expand, or tap the handle to toggle (usePullUp).
  const grow = () => { setExpanded(true); haptic("selection"); playSound("sheet.full"); };
  const toggle = () => { if (expanded) { setExpanded(false); haptic("selection"); playSound("sheet.snap"); } else grow(); };
  const [pullRef, lastPull] = usePullUp(!expandable || expanded, grow);

  const dialogClass = [
    "flow-drawer__dialog",
    wide ? "flow-drawer__dialog--wide" : "",
    expandable ? (expanded ? "flow-drawer__dialog--full" : "flow-drawer__dialog--half") : "",
  ].filter(Boolean).join(" ");

  // Sounds on a change only: a sheet that mounts already open (or closed) says nothing.
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    playSound(open ? "sheet.open" : "sheet.close");
  }, [open]);
  return (
    <Drawer isOpen={open} onOpenChange={(isOpen) => { if (!isOpen) requestClose(); }}>
      <Drawer.Backdrop variant="blur" isDismissable={!dirty}>
        <Drawer.Content placement="bottom" className="flow-drawer">
          <Drawer.Dialog className={dialogClass}>
            <Drawer.Handle
              ref={pullRef}
              className={expandable ? "flow-drawer__grip" : undefined}
              onPointerUp={expandable ? () => { if (lastPull.current <= TAP_PX) toggle(); } : undefined}
            />
            <Drawer.Header className="flow-drawer__header">
              <Drawer.Heading>{title}</Drawer.Heading>
              {subtitle ? <p className="flow-drawer__sub">{subtitle}</p> : null}
              <Button slot="close" variant="tertiary" size="sm" className="flow-drawer__close" aria-label={closeLabel}>
                <Icon name="x" size="sm" />
                <span>{closeLabel}</span>
              </Button>
            </Drawer.Header>
            <Drawer.Body
              className={bodyClassName}
              aria-live={live ? "polite" : undefined}
              onScroll={expandable && !expanded ? (e) => { if (e.currentTarget.scrollTop > 24) setExpanded(true); } : undefined}
            >
              <WidgetBoundary label="محتوای این برگه">{children}</WidgetBoundary>
            </Drawer.Body>
            {asking ? (
              <div className="flow-drawer__discard" role="alert">
                <p>تغییرهای ذخیره‌نشده از دست می‌روند.</p>
                <Button variant="secondary" onPress={() => setAsking(false)}>
                  <Icon name="edit" size="sm" />
                  ادامهٔ ویرایش
                </Button>
                <Button variant="danger" onPress={() => { setAsking(false); onClose(); }}>
                  <Icon name="trash" size="sm" />
                  دور ریختن تغییرها
                </Button>
              </div>
            ) : null}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
