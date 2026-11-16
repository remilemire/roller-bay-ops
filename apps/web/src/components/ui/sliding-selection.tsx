'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SelectionBounds = { x: number; y: number; width: number; height: number };

/** Moving glass for switches, wrapping filters, and route navigation. */
export function SlidingSelection({
  label,
  value,
  className,
  selection = 'pressed',
  children,
}: {
  label: string;
  value: string | undefined;
  className: string;
  selection?: 'pressed' | 'page';
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<SelectionBounds | null>(null);

  useLayoutEffect(() => {
    const track = container.current!;
    const measure = () => {
      const selected = track.querySelector<HTMLElement>(
        selection === 'page'
          ? 'a[aria-current="page"]'
          : 'button[aria-pressed="true"]',
      );
      const next = selected
        ? {
            x: selected.offsetLeft,
            y: selected.offsetTop,
            width: selected.offsetWidth,
            height: selected.offsetHeight,
          }
        : null;
      setBounds((previous) =>
        previous?.x === next?.x &&
        previous?.y === next?.y &&
        previous?.width === next?.width &&
        previous?.height === next?.height
          ? previous
          : next,
      );
    };
    measure();
    // Observe each option too: fonts, labels, and wrapping can move the pill
    // even when the track's overall width does not change.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    track
      .querySelectorAll('button, a')
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [value, children, selection]);

  return (
    <div
      ref={container}
      className={cn('sliding-selection', className)}
      role="group"
      aria-label={label}
    >
      {bounds && (
        <span
          className="selection-pill"
          aria-hidden="true"
          style={{
            width: bounds.width,
            height: bounds.height,
            transform: `translate(${bounds.x}px, ${bounds.y}px)`,
          }}
        />
      )}
      {children}
    </div>
  );
}
