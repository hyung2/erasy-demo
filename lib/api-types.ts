// API 응답 계약(DTO) — BE 응답 shape ↔ FE 훅 타입 1:1 정합의 SSOT.
// 규약: 모든 성공 응답은 { data } 래핑, 필드는 camelCase. 스텁은 _stub:true 플래그로 실연동 아님을 표기.
// W2에서 실구현이 이 shape를 그대로 채운다(계약 고정).

export type ApiEnvelope<T> = {
  data: T;
  _stub?: boolean; // true = 아직 더미/미구현(정직 표기). 실구현 시 제거.
};

// GET /api/accounts — 계정 인벤토리
export type AccountDTO = {
  id: string;
  name: string;
  category: 'social' | 'overseas' | 'domestic';
  provider: 'google' | 'naver' | 'kakao' | 'apple' | 'manual';
  source: 'seed' | 'user_input' | 'oauth_linked';
  lastUsedDays: number; // lastUsedAt에서 파생(런타임)
  breached: boolean;
  risk: 'low' | 'medium' | 'high'; // deriveRisk 파생
};

// GET /api/score — 점수/등급/추이
export type ScoreDTO = {
  score: number;
  grade: '양호' | '주의' | '위험';
  delta: number; // 직전 스냅샷 대비
  trend: number[]; // 추이(스냅샷 시계열)
  coverage: number; // 확인 커버리지(0~1)
  coveredCount: number;
};

// GET /api/guard — 실시간 가드(알림 + 유출)
export type AlertDTO = {
  id: string;
  type: 'breach' | 'score_drop' | 'recleanup';
  message: string;
  when: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
};
export type BreachDTO = {
  id: string;
  service: string;
  breachDate: string;
  exposedFields: string[];
  advice: string;
  severity: 'high' | 'mid' | 'low';
  resolved: boolean;
};
export type GuardDTO = {
  alerts: AlertDTO[];
  breaches: BreachDTO[];
};

// GET /api/accounts/[id]/access — 접속기록
export type AccessLogDTO = {
  id: string;
  timestamp: string;
  location: string;
  device: string;
  suspicious: boolean;
};

// POST /api/cleanup/mark — 정리 상태 전이
export type CleanupMarkRequest = {
  accountId: string;
  actionType:
    | 'password_change'
    | 'delete'
    | 'revoke'
    | 'logout_sessions'
    | 'unsubscribe';
  status: 'queued' | 'in_progress' | 'done' | 'failed';
};
export type CleanupMarkResponse = {
  id: string;
  status: 'queued' | 'in_progress' | 'done' | 'failed';
  completedAt: string | null;
};
