"use client";

import type { ReactNode } from "react";
import { Button, Drawer } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";

/** Every bottom sheet in the app, on a HeroUI bottom Drawer (docs/roadmap.md §10): the «بیشتر»
 *  list, the quick actions, the filters, a card's breakdown, the customer sheet and the tap
 *  flows. The Drawer brings the backdrop, Escape, drag-down to dismiss, a focus trap and the
 *  focus return; HeroUIProvider draws it in the `.meridian` root so a transformed ancestor
 *  cannot misplace it. The body sits in `.tapflow` by default so its rows can use the 52 px
 *  answer-button styles. */
export default function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  closeLabel,
  bodyClassName = "tapflow",
  live = false,
  wide = false,
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
  children: ReactNode;
}) {
  return (
    <Drawer isOpen={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Drawer.Backdrop variant="blur">
        <Drawer.Content placement="bottom" className="flow-drawer">
          <Drawer.Dialog className={`flow-drawer__dialog${wide ? " flow-drawer__dialog--wide" : ""}`}>
            <Drawer.Handle />
            <Drawer.Header className="flow-drawer__header">
              <Drawer.Heading>{title}</Drawer.Heading>
              {subtitle ? <p className="flow-drawer__sub">{subtitle}</p> : null}
              <Button slot="close" variant="tertiary" size="sm" className="flow-drawer__close" aria-label={closeLabel}>
                <Icon name="x" size="sm" />
                <span>{closeLabel}</span>
              </Button>
            </Drawer.Header>
            <Drawer.Body className={bodyClassName} aria-live={live ? "polite" : undefined}>
              {children}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
