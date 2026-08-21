'use client';

// 흐름 상태(라우트 간 유지). root layout에 두어 /dashboard·/cleanup 이동 시에도 보존한다.
// 정리 완료 여부만 추적한다.
//
// sessionStorage를 **단일 출처**로 삼고 useSyncExternalStore로 구독한다.
//   예전에는 useState로 들고 effect에서 sessionStorage를 읽어 setState 했는데, 그러면
//   같은 사실이 두 곳(React state·스토리지)에 살면서 effect가 매번 둘을 맞춰야 한다.
//   React가 렌더 중 외부 값을 안전하게 읽는 방법으로 제공하는 것이 이 훅이고,
//   서버 스냅샷을 따로 받으므로 SSR에서 스토리지에 손대지 않는다.
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type DemoState = {
  cleaned: boolean;
  markCleaned: () => void;
  reset: () => void;
};

const DemoContext = createContext<DemoState | null>(null);
const KEY = 'erasy-demo-cleaned';

// 같은 탭 안의 변경은 storage 이벤트가 발생하지 않는다(다른 탭에서만 뜬다).
// 그래서 쓰기 쪽에서 직접 알린다.
let listeners: (() => void)[] = [];
function emit() {
  for (const l of listeners) l();
}
function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}
function getSnapshot(): boolean {
  return sessionStorage.getItem(KEY) === '1';
}
/** 서버에는 세션 스토리지가 없다. 정리 이력이 없는 상태로 시작한다. */
function getServerSnapshot(): boolean {
  return false;
}

export function DemoStateClient({ children }: { children: ReactNode }) {
  const cleaned = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function markCleaned() {
    sessionStorage.setItem(KEY, '1');
    emit();
  }
  function reset() {
    sessionStorage.removeItem(KEY);
    emit();
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
