'use client';
import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const tipWidth = 280;
const gap = 6;

// The visible tip is portalled to the body because table wrappers clip
// overflow and glass panels' backdrop filters trap fixed positioning. A hidden
// in-place copy keeps aria-describedby working while the tip is closed.
export function InfoTip({ text, id }: { text: string; id?: string }) {
  const generated = useId();
  const tipId = id ?? generated;
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - tipWidth / 2, 8),
      window.innerWidth - tipWidth - 8,
    );
    const above = rect.bottom + 140 > window.innerHeight;
    setPosition({
      top: above ? rect.top - gap : rect.bottom + gap,
      left,
      above,
    });
  };
  const hide = () => setPosition(null);

  useEffect(() => {
    if (!position) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [position]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-tip"
        aria-label="More information"
        aria-describedby={tipId}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(event) => event.key === 'Escape' && hide()}
      >
        <Info aria-hidden size={13} />
      </button>
      <span id={tipId} hidden>
        {text}
      </span>
      {position &&
        createPortal(
          <span
            role="tooltip"
            aria-hidden
            className="info-tip-text glass"
            style={{
              top: position.top,
              left: position.left,
              width: tipWidth,
              transform: position.above ? 'translateY(-100%)' : undefined,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
