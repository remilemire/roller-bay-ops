'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Packs variable-height orders without changing their DOM or keyboard order. */
export function StationOrderGrid({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = container.current!;
    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>('.station-order'),
    );
    if (typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.trim().split(/\s+/).length;
      if (columns < 2 || !cards.length) {
        delete grid.dataset.packed;
        cards.forEach((card) => card.style.removeProperty('grid-row-end'));
        return;
      }
      const gap = parseFloat(style.columnGap);
      // Read every intrinsic height before writing spans. One-pixel grid rows
      // fill the gaps below shorter cards without reordering focusable actions.
      const spans = cards.map((card) =>
        Math.ceil(card.getBoundingClientRect().height + gap),
      );
      cards.forEach((card, index) => {
        const span = `span ${spans[index]}`;
        if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span;
      });
      grid.dataset.packed = 'true';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className="station-orders" ref={container}>
      {children}
    </div>
  );
}
