// API 응답 계약(DTO) — BE 응답 shape ↔ FE 훅 타입 1:1 정합의 SSOT.
// 규약: 모든 성공 응답은 { data } 래핑, 필드는 camelCase. 스텁은 _stub:true 플래그로 실연동 아님을 표기.
// W2에서 실구현이 이 shape를 그대로 채운다(계약 고정).
import type { AxisKey, AxisScore, ExpectedGainItem } from './score-v2';

export type ApiEnvelope<T> = {
  data: T;
  _stub?: boolean; // true = 아직 더미/미구현(정직 표기). 실구현 시 제거.
};

// GET /api/accounts — 계정 인벤토리
export type AccountDTO = {
  id: string;
  name: string;
  // unknown: 소셜 연결목록처럼 서비스명만 오는 입력에서 분류를 확정할 수 없는 경우.
  // 임의로 domestic/overseas를 찍지 않는다.
  category: 'social' | 'overseas' | 'domestic' | 'unknown';
  provider: 'google' | 'naver' | 'kakao' | 'apple' | 'manual';
  source: 'seed' | 'user_input' | 'oauth_linked' | 'mail_scan' | 'social_link';
  lastUsedDays: number; // lastUsedAt에서 파생(런타임)
  breached: boolean;
  risk: 'low' | 'medium' | 'high'; // deriveRisk 파생
  // 자가신고 신호(T5.4) — 카드에 "직접 입력" 라벨 표시 근거. seed 폴백은 undefined.
  twoFactorEnabled?: boolean;
  passwordReused?: boolean;
  discovered?: boolean;
};

// 마지막 사용 시기 자가신고 버킷 → lastUsedAt 파생(정밀 일자 대신 구간 입력).
export type LastUsedBucket = 'within1y' | '1to2y' | 'over2y' | 'unknown';

// PATCH /api/accounts/[id] — 자가신고 신호 갱신(전 필드 선택 — 부분 갱신).
export type AccountUpdateRequest = {
  passwordReused?: boolean;
  twoFactorEnabled?: boolean;
  lastUsedBucket?: LastUsedBucket;
  discovered?: boolean;
};

// POST /api/accounts — 몰랐던 계정 직접 추가(F2). 서비스명만 입력 → 나머지 파생.
export type AccountCreateRequest = {
  name: string;
};

// GET /api/score — 점수/등급/추이
// v2 다차원 전환: 기존 필드(score·grade·delta·trend·coverage·coveredCount) shape 불변 = FE 배선 무손상.
//   axes·weakestAxis·expectedGains는 additive(신규). FE 소비는 T4.4에서 배선.
export type ScoreDTO = {
  score: number; // 종합(composite)
  grade: '양호' | '주의' | '위험';
  delta: number; // 직전 스냅샷 대비
  trend: number[]; // 추이(스냅샷 시계열)
  // 추이 점별 기록 시각(ISO). trend와 인덱스 1:1. 차트 x축 라벨 근거 — 월별 더미 상수 대체.
  //   이력이 없으면 빈 배열 → 화면은 가짜 선 대신 "쌓이면 보여드려요"로 방어.
  trendPoints: { score: number; at: string }[];
  coverage: number; // 확인 커버리지(0~1) = surface 축(헤드라인)
  coveredCount: number;
  // ── v2 additive ──
  axes: Record<AxisKey, AxisScore>; // 4축(E·S·H·T) 상세(raw score·measured·coverage)
  weakestAxis: AxisKey | null; // 최약축(추천 액션 근거)
  expectedGains: ExpectedGainItem[]; // 회복 레버별 기대 상승폭(하한 0)
  // 회복 투영 — 이 사용자의 실제 계정·정리 큐 기준 "담아 둔 정리를 끝내면 여기까지".
  //   결과 화면이 클라이언트에서 시드로 자체 계산하던 것을 대체한다. 계정 수와 무관하게
  //   항상 24→93이 나오던 결함의 수정 경로다(2026-08-04).
  recovery: RecoveryProjectionDTO;
};

// 회복 투영 DTO. score-projection의 RecoveryProjection과 동형(직렬화 가능 필드만).
export type RecoveryProjectionDTO = {
  beforeComposite: number | null;
  afterComposite: number | null;
  beforeAxes: Record<AxisKey, AxisScore>;
  afterAxes: Record<AxisKey, AxisScore>;
  axisKeys: AxisKey[];
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
