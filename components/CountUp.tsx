'use client';

// 수치 카운트업(rAF). 진입 시 0→목표값, 값이 바뀌면 이전값→새값(예: 안전도 24→90).
// prefers-reduced-motion 시 애니 없이 최종값 즉시 표기.
import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  duration?: number;
  className?: string;
};

function prefersReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function CountUp({ value, duration = 900, className }: Props) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReduced()) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}
