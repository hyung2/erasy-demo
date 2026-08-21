'use client';

// 수치 카운트업(rAF). 진입 시 0→목표값, 값이 바뀌면 이전값→새값(예: 안전도 28→35).
// prefers-reduced-motion이면 애니메이션 없이 최종값을 그대로 쓴다.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

type Props = {
  value: number;
  duration?: number;
  className?: string;
};

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function getReduced(): boolean {
  return window.matchMedia(REDUCED_QUERY).matches;
}
/** 서버에는 매체 질의가 없다. 애니메이션을 켠 상태로 시작하고 클라이언트가 정정한다. */
function getReducedServer(): boolean {
  return false;
}

export function CountUp({ value, duration = 900, className }: Props) {
  // 렌더 중 matchMedia를 직접 부르지 않는다. React가 외부 값을 안전하게 읽는 통로가 이 훅이고,
  // 사용자가 시스템 설정을 바꾸면 구독을 통해 반영된다.
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getReducedServer);

  const [animated, setAnimated] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  // 애니메이션을 끈 상태에서는 state를 거치지 않고 값을 그대로 보여준다.
  // 예전에는 effect 안에서 setDisplay(value)를 동기로 불렀는데, 그 자리가 곧
  // "effect가 렌더를 연쇄로 일으키는" 자리였다. 계산으로 대신할 수 있으면 상태를 두지 않는다.
  const display = reduced ? value : animated;

  useEffect(() => {
    if (reduced) {
      // 다음 애니메이션의 출발점은 맞춰 둔다 — 설정을 도로 켜면 여기서 이어진다.
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
      setAnimated(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, reduced]);

  return <span className={className}>{display}</span>;
}
