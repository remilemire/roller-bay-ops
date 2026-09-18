'use client';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  // Callers open dialogs without a Radix Trigger, so remember where focus belongs.
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          className="dialog-content"
          {...(!description ? { 'aria-describedby': undefined } : {})}
          // Escape on an open lookup list closes the list, not the dialog.
          onEscapeKeyDown={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.getAttribute('aria-expanded') === 'true'
            )
              event.preventDefault();
          }}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="dialog-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              {description && (
                <Primitive.Description>{description}</Primitive.Description>
              )}
            </div>
            <Primitive.Close
              className="button button-ghost button-icon"
              aria-label="Close dialog"
            >
              <X size={20} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
