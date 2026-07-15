'use client';

// 데모 흐름 상태(라우트 간 유지). root layout에 두어 /dashboard·/cleanup 이동 시에도 보존.
// 연출 전용 — 실제 백엔드/세션 없음. 정리 완료 여부만 추적해 안전도 24→90 전환에 사용.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type DemoState = {
  cleaned: boolean;
  markCleaned: () => void;
  reset: () => void;
};

const DemoContext = createContext<DemoState | null>(null);
const KEY = 'erasy-demo-cleaned';

export function DemoStateClient({ children }: { children: ReactNode }) {
  const [cleaned, setCleaned] = useState(false);

  // 새로고침에도 흐름 상태 유지(연출 연속성).
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(KEY) === '1') {
      setCleaned(true);
    }
  }, []);

  function markCleaned() {
    setCleaned(true);
    if (typeof window !== 'undefined') sessionStorage.setItem(KEY, '1');
  }
  function reset() {
    setCleaned(false);
    if (typeof window !== 'undefined') sessionStorage.removeItem(KEY);
  }

  return (
    <DemoContext.Provider value={{ cleaned, markCleaned, reset }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used within DemoStateClient');
  return ctx;
}
