"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Radix dialog shell shared by the calendar dialogs. Always open while mounted; closing calls
 * `onClose`. Focus goes back to whatever opened it (Radix default), or to `onCloseFocus` when given
 * (entries can be re-rendered elsewhere after a change, so the calendar finds them again).
 */
export default function Modal({
  title,
  description,
  onClose,
  onCloseFocus,
  children,
  wide = false,
}: {
  title: ReactNode;
  description: ReactNode;
  onClose: () => void;
  onCloseFocus?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations("staff.calendar.appt");
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            if (!onCloseFocus) return;
            e.preventDefault();
            onCloseFocus();
          }}
          className={`fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[18px] bg-white p-5 shadow-[0_20px_60px_rgba(16,48,46,0.25)] outline-none sm:p-6 ${
            wide ? "max-w-xl" : "max-w-md"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-xl font-bold tracking-tight text-ink">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mt-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg text-mute hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[13px] text-mute">{description}</Dialog.Description>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
