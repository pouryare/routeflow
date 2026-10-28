"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Drawer } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import WidgetBoundary from "@/components/WidgetBoundary";
import { useBackToClose } from "@/lib/useBackToClose";
import { haptic } from "@/lib/haptics";

/** Every bottom sheet in the app, on a HeroUI bottom Drawer (docs/roadmap.md §10): the «بیشتر»
 *  list, the quick actions, the filters, a card's breakdown, the customer sheet and the tap
 *  flows. The Drawer brings the backdrop, Escape, drag-down to dismiss, a focus trap and the
 *  focus return; HeroUIProvider draws it in the `.meridian` root so a transformed ancestor
 *  cannot misplace it. The body sits in `.tapflow` by default so its rows can use the 52 px
 *  answer-button styles.
 *
 *  On top of the Drawer: the phone's back button closes the sheet (useBackToClose), opening
 *  ticks (lib/haptics), a sheet holding unsaved input (`dirty`) asks before any way of closing
 *  drops it, and an `expandable` sheet opens at half height and grows to full when its handle
 *  is pulled up or tapped, or its body is scrolled. */
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

  // Pull the handle up past a short distance to expand; a tap toggles. HeroUI's own drag only
  // follows the finger downward, so the two never fight over a gesture.
  const pullFrom = useRef<number | null>(null);
  const toggle = () => { setExpanded((e) => !e); haptic("selection"); };

  const dialogClass = [
    "flow-drawer__dialog",
    wide ? "flow-drawer__dialog--wide" : "",
    expandable ? (expanded ? "flow-drawer__dialog--full" : "flow-drawer__dialog--half") : "",
  ].filter(Boolean).join(" ");

  return (
    <Drawer isOpen={open} onOpenChange={(isOpen) => { if (!isOpen) requestClose(); }}>
      <Drawer.Backdrop variant="blur" isDismissable={!dirty}>
        <Drawer.Content placement="bottom" className="flow-drawer">
          <Drawer.Dialog className={dialogClass}>
            <Drawer.Handle
              className={expandable ? "flow-drawer__grip" : undefined}
              onPointerDown={expandable ? (e) => { pullFrom.current = e.clientY; } : undefined}
              onPointerMove={expandable ? (e) => {
                // Decided within the first 6 px: past 8 px HeroUI captures the pointer on the
                // dialog and the handle hears nothing more of this gesture.
                if (pullFrom.current !== null && pullFrom.current - e.clientY > 6) {
                  pullFrom.current = null;
                  if (!expanded) toggle();
                }
              } : undefined}
              onPointerUp={expandable ? () => {
                if (pullFrom.current !== null) toggle();
                pullFrom.current = null;
              } : undefined}
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
