// API 응답 계약(DTO) — BE 응답 shape ↔ FE 훅 타입 1:1 정합의 SSOT.
// 규약: 모든 성공 응답은 { data } 래핑, 필드는 camelCase. 스텁은 _stub:true 플래그로 실연동 아님을 표기.
// W2에서 실구현이 이 shape를 그대로 채운다(계약 고정).
import type { AxisKey, AxisScore, ExpectedGainItem } from './score-v2';

/**
 * "마지막 사용 시각을 모른다"를 나타내는 센티넬(일).
 *
 * null 대신 큰 수를 쓰는 것은 기존 계약이다 — 정렬·버킷 역매핑이 숫자를 전제한다.
 * 다만 **집계할 때는 반드시 걸러야 한다.** 이 값이 휴면 계산에 섞이면 모르는 것이
 * 위험으로 둔갑한다.
 */
export const UNKNOWN_LAST_USED_DAYS = 3650;

export type ApiEnvelope<T> = {
  data: T;
  _stub?: boolean; // true = 아직 더미/미구현(정직 표기). 실구현 시 제거.
};

// GET /api/accounts — 계정 인벤토리
export type AccountDTO = {
  id: string;
  /** 화면에 쓰는 이름. 사람이 확인한 표시명이 있으면 그것, 없으면 수집 원문. */
  name: string;
  /**
   * 링크를 찾을 때 쓰는 이름 — **수집 원문 그대로**.
   *
   * 보여주는 이름과 찾는 이름을 나누는 이유: 정리 경로는 서비스명으로 카탈로그를 뒤져
   * 도메인을 얻는다. 표시명을 예쁘게 바꾸면("google.com" → "Google Drive") 그 조회가
   * 빗나가 링크가 사라진다. 화면을 다듬는 변경이 기능을 조용히 끄는 일은 없어야 한다.
   */
  linkName?: string;
  // unknown: 소셜 연결목록처럼 서비스명만 오는 입력에서 분류를 확정할 수 없는 경우.
  // 임의로 domestic/overseas를 찍지 않는다.
  category: 'social' | 'overseas' | 'domestic' | 'unknown';
  provider: 'google' | 'naver' | 'kakao' | 'apple' | 'manual';
  source: 'seed' | 'user_input' | 'oauth_linked' | 'mail_scan' | 'social_link';
  // lastUsedAt에서 파생(런타임). 마지막 사용 시각을 모르면 UNKNOWN_LAST_USED_DAYS.
  //   **미상은 "오래 안 씀"이 아니다.** 소셜 연결목록은 플랫폼이 사용일을 주지 않아
  //   실계정 265개 중 205개가 미상이었는데, 집계가 그걸 휴면으로 세어 화면이
  //   "81%가 12개월 이상 미사용"이라고 말했다(2026-08-25 실측). 우리가 모르는 것이다.
  lastUsedDays: number;
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
  // 이미 끝낸 정리가 **실제로** 올린 폭. 투영(recovery)이 "끝내면 여기까지"라면 이건
  // "끝냈더니 이만큼 올랐다"다. 완료분이 없으면 null이고, 그때 결과 화면은 예상만 말한다.
  cleaned: CleanedGainDTO | null;
};

export type CleanedGainDTO = {
  completedCount: number;
  before: number; // 정리하지 않았다면의 점수(완료 표시를 되돌려 같은 엔진으로 재계산)
  after: number;
  gain: number;
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
  // discovery·acknowledge는 실제 활동 피드를 붙이며 추가(DB AlertType enum과 별개 — 이 세 종류는
  // Alert 레코드가 아니라 계정·정리 이력에서 파생한다).
  type: 'breach' | 'score_drop' | 'recleanup' | 'discovery' | 'acknowledge';
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
  /**
   * 유출 대조를 마지막으로 수행한 시각(ISO). null이면 한 번도 하지 않았다는 뜻이다.
   *
   * 화면이 "유출 없음"과 "아직 안 봤음"을 구분하려면 이 값이 필요하다. 둘을 같은 문장으로
   * 말하면 아무것도 대조하지 않은 사람에게 안심을 파는 셈이 된다.
   */
  breachCheckedAt: string | null;
};

// GET /api/accounts/[id]/access — 접속기록
export type AccessLogDTO = {
  id: string;
  timestamp: string;
  location: string;
  device: string;
  suspicious: boolean;
};

// ── /api/cleanup/requests — 정리 큐 담기·빼기·조회 ──
//
// 왜 mark와 별개인가: mark는 이미 담긴 요청의 **상태 전이**(queued→done) 계약이다.
// 담기는 요청의 **생성**이고, 사용자가 한 번에 수십 건을 담는다. 두 계약을 한 라우트에
// 섞으면 accountId 단건·status 필수라는 mark의 shape가 일괄 담기를 막는다(스키마 O6 주석의 분리 의도).
//
// actionType은 서버가 provider에서 파생한다 — 클라이언트가 정하지 않는다.
// OAuth로 연결된 계정은 연결 해제(revoke), 자체 가입 계정은 삭제 요청(delete)이 실제 행동이며,
// 이건 추측이 아니라 provider가 이미 알고 있는 사실이다.
export type CleanupQueueItemDTO = {
  accountId: string;
  accountName: string;
  actionType: 'delete' | 'revoke';
  status: 'queued' | 'in_progress' | 'done' | 'failed';
  createdAt: string;
};

export type CleanupQueueRequest = {
  accountIds: string[];
};

// queued = 이번에 새로 담긴 수 · alreadyQueued = 이미 담겨 있어 건너뛴 수(멱등).
// notFound = 이 사용자 소유가 아니거나 DB에 없는 id 수. 시드 폴백 화면(실계정 0건)에서
//   담기를 누르면 여기로 잡힌다 — 조용히 0건 성공으로 보이면 안 되므로 수를 내려보낸다.
export type CleanupQueueResponse = {
  queued: number;
  alreadyQueued: number;
  notFound: number;
  items: CleanupQueueItemDTO[];
};

// DELETE /api/cleanup/requests — 큐에서 빼기(미완료분만). 완료된 이력은 지우지 않는다.
export type CleanupQueueRemoveResponse = {
  removed: number;
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
