// 전 화면 더미 데이터 단일 소스. 위험도·점수·등급은 리터럴 금지 — 아래 derive 함수로 산출.
// (클릭 목업: 실제 API 호출 없음. 상태 전이는 화면 로컬 setTimeout으로만.)

export type LinkMethod =
  | 'google-oauth'
  | 'kakao-oauth'
  | 'apple-oauth'
  | 'naver-oauth'
  | 'email-password';

export type Category = 'social' | 'overseas' | 'domestic';
export type Risk = 'low' | 'medium' | 'high';

export type Account = {
  id: string;
  service: string;
  category: Category;
  linkMethod: LinkMethod;
  lastUsedDays: number;
  unusedMonths: number;
  breached: boolean;
  // ── W3 점수 엔진 신호(선택 필드 — 시드·엔진용, 기존 FE derive 무영향) ──
  // 정본: 03-step02-mvp/score-spec-T3.0.md 3장. 미지정 = false(스키마 default와 동일).
  passwordReused?: boolean; // 재사용 서사: 2015 뽐뿌 유출 비번을 6계정에서 재사용
  twoFactorEnabled?: boolean; // manual 계정만 점수 신호(OAuth는 provider 위임)
  discovered?: boolean; // 사용자가 몰랐던 계정("이 중 3개는 모르셨죠")
};

// 시드 데모 사용자 id — seed.ts·score-service 공용 상수(경로 정본).
export const DEMO_USER_ID = 'seed-user-demo';

export const linkMethodLabel: Record<LinkMethod, string> = {
  'google-oauth': '구글 로그인',
  'kakao-oauth': '카카오 로그인',
  'apple-oauth': '애플 로그인',
  'naver-oauth': '네이버 로그인',
  'email-password': '이메일 · 비밀번호',
};

export const riskLabel: Record<Risk, string> = {
  low: '낮음',
  medium: '중간',
  high: '높음',
};

// 위험도: 유출 or 24개월+ 장기 미사용 → 높음 / 12개월+ 미사용 or 해외 → 중간 / 그 외 → 낮음
export function deriveRisk(a: Account): Risk {
  if (a.breached || a.unusedMonths >= 24) return 'high';
  if (a.unusedMonths >= 12 || a.category === 'overseas') return 'medium';
  return 'low';
}

// 위험도 정렬(높음→중간→낮음). 순서는 deriveRisk 파생 — 리터럴 순서 하드코딩 금지.
// 동률은 장기 미사용(unusedMonths) 큰 순 → 유출·방치 계정이 위로.
const riskRank: Record<Risk, number> = { high: 2, medium: 1, low: 0 };
export function sortByRiskDesc(list: Account[]): Account[] {
  return [...list].sort((a, b) => {
    const d = riskRank[deriveRisk(b)] - riskRank[deriveRisk(a)];
    return d !== 0 ? d : b.unusedMonths - a.unusedMonths;
  });
}

// 마지막 사용 표기(원본 lastUsedDays에서 산출 — 하드코딩 금지)
export function deriveLastUsed(a: Account): string {
  const d = a.lastUsedDays;
  if (d < 1) return '오늘';
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.round(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 프라이버시 점수: 100 - (유출 6 + 장기미사용-고위험 8 + 중위험 2). 하한 0, 상한 100.
// 가중치는 시연용 예시값. 아래 시드에서 유출3·고위험(비유출)1·중위험6 → 100-38 = 62.
export function derivePrivacyScore(accounts: Account[]): number {
  const breached = accounts.filter((a) => a.breached).length;
  const highUnused = accounts.filter(
    (a) => !a.breached && deriveRisk(a) === 'high',
  ).length;
  const medium = accounts.filter((a) => deriveRisk(a) === 'medium').length;
  const deduction = breached * 6 + highUnused * 8 + medium * 2;
  return Math.max(0, Math.min(100, 100 - deduction));
}

export function deriveGrade(score: number): '양호' | '주의' | '위험' {
  return score >= 80 ? '양호' : score >= 50 ? '주의' : '위험';
}

export function gradeTone(grade: '양호' | '주의' | '위험'): 'success' | 'warning' | 'error' {
  return grade === '양호' ? 'success' : grade === '주의' ? 'warning' : 'error';
}

export function riskTone(risk: Risk): 'success' | 'warning' | 'error' {
  return risk === 'low' ? 'success' : risk === 'medium' ? 'warning' : 'error';
}

// 계정 24개: 소셜 9(구글4·카카오3·애플2) / 해외 6 / 국내 9. 유출 3, 미사용 12개월+ 7.
// 점수 신호(W3): 재사용 6(Gmail·Amazon·인터파크·뽐뿌·네이버·토스 — 비밀번호 보유 계정만),
//   2FA true 4(Gmail·카카오톡·iCloud·토스), discovered 3(Quora·뽐뿌·싸이월드).
export const accounts: Account[] = [
  // 소셜 구글 4
  { id: 'a01', service: 'Gmail', category: 'social', linkMethod: 'google-oauth', lastUsedDays: 0, unusedMonths: 0, breached: false, passwordReused: true, twoFactorEnabled: true },
  { id: 'a02', service: 'YouTube', category: 'social', linkMethod: 'google-oauth', lastUsedDays: 1, unusedMonths: 0, breached: false },
  { id: 'a03', service: 'Google Drive', category: 'social', linkMethod: 'google-oauth', lastUsedDays: 5, unusedMonths: 0, breached: false },
  { id: 'a04', service: 'Google Photos', category: 'social', linkMethod: 'google-oauth', lastUsedDays: 40, unusedMonths: 1, breached: false },
  // 소셜 카카오 3
  { id: 'a05', service: '카카오톡', category: 'social', linkMethod: 'kakao-oauth', lastUsedDays: 0, unusedMonths: 0, breached: false, twoFactorEnabled: true },
  { id: 'a06', service: '카카오페이', category: 'social', linkMethod: 'kakao-oauth', lastUsedDays: 3, unusedMonths: 0, breached: false },
  { id: 'a07', service: '카카오스토리', category: 'social', linkMethod: 'kakao-oauth', lastUsedDays: 540, unusedMonths: 18, breached: false },
  // 소셜 애플 2
  { id: 'a08', service: 'iCloud', category: 'social', linkMethod: 'apple-oauth', lastUsedDays: 2, unusedMonths: 0, breached: false, twoFactorEnabled: true },
  { id: 'a09', service: 'Apple Music', category: 'social', linkMethod: 'apple-oauth', lastUsedDays: 60, unusedMonths: 2, breached: false },
  // 해외 6
  { id: 'a10', service: 'Netflix', category: 'overseas', linkMethod: 'google-oauth', lastUsedDays: 90, unusedMonths: 3, breached: false },
  { id: 'a11', service: 'Spotify', category: 'overseas', linkMethod: 'google-oauth', lastUsedDays: 390, unusedMonths: 13, breached: false },
  { id: 'a12', service: 'Amazon', category: 'overseas', linkMethod: 'email-password', lastUsedDays: 365, unusedMonths: 12, breached: false, passwordReused: true },
  { id: 'a13', service: 'Notion', category: 'overseas', linkMethod: 'google-oauth', lastUsedDays: 20, unusedMonths: 0, breached: false },
  { id: 'a14', service: 'Medium', category: 'overseas', linkMethod: 'google-oauth', lastUsedDays: 450, unusedMonths: 15, breached: false },
  { id: 'a15', service: 'Quora', category: 'overseas', linkMethod: 'kakao-oauth', lastUsedDays: 420, unusedMonths: 14, breached: true, discovered: true },
  // 국내 9 (인터파크·뽐뿌 = 실제 국내 유출 이력 서비스)
  { id: 'a16', service: '인터파크', category: 'domestic', linkMethod: 'email-password', lastUsedDays: 240, unusedMonths: 8, breached: true, passwordReused: true },
  { id: 'a17', service: '뽐뿌', category: 'domestic', linkMethod: 'email-password', lastUsedDays: 600, unusedMonths: 20, breached: true, passwordReused: true, discovered: true },
  { id: 'a18', service: '싸이월드', category: 'domestic', linkMethod: 'naver-oauth', lastUsedDays: 1100, unusedMonths: 36, breached: false, discovered: true },
  { id: 'a19', service: '네이버', category: 'domestic', linkMethod: 'naver-oauth', lastUsedDays: 0, unusedMonths: 0, breached: false, passwordReused: true },
  { id: 'a20', service: '쿠팡', category: 'domestic', linkMethod: 'naver-oauth', lastUsedDays: 4, unusedMonths: 0, breached: false },
  { id: 'a21', service: '배달의민족', category: 'domestic', linkMethod: 'kakao-oauth', lastUsedDays: 7, unusedMonths: 0, breached: false },
  { id: 'a22', service: '토스', category: 'domestic', linkMethod: 'email-password', lastUsedDays: 1, unusedMonths: 0, breached: false, passwordReused: true, twoFactorEnabled: true },
  { id: 'a23', service: '멜론', category: 'domestic', linkMethod: 'kakao-oauth', lastUsedDays: 50, unusedMonths: 1, breached: false },
  { id: 'a24', service: '11번가', category: 'domestic', linkMethod: 'naver-oauth', lastUsedDays: 200, unusedMonths: 6, breached: false },
];

export type Breach = {
  id: string;
  service: string;
  breachDate: string;
  exposedFields: string[];
  advice: string;
  resolved: boolean;
  severity: 'high' | 'mid' | 'low'; // 침해 심각도(디자이너 정본 배지값)
};

export const breaches: Breach[] = [
  { id: 'b1', service: 'Quora', breachDate: '2018-12', exposedFields: ['이메일', '비밀번호'], advice: '비밀번호를 변경하고, 같은 비밀번호를 쓰는 다른 서비스도 함께 교체하세요.', resolved: false, severity: 'high' },
  { id: 'b2', service: '인터파크', breachDate: '2016-05', exposedFields: ['이메일', '이름', '주소'], advice: '피싱 메일에 주의하고, 2단계 인증을 활성화하세요.', resolved: false, severity: 'high' },
  { id: 'b3', service: '뽐뿌', breachDate: '2015-09', exposedFields: ['비밀번호'], advice: '비밀번호를 변경하고 2단계 인증을 켜세요.', resolved: false, severity: 'mid' },
  { id: 'b4', service: 'LinkedIn', breachDate: '2012-06', exposedFields: ['이메일'], advice: '이미 조치 완료된 항목입니다.', resolved: true, severity: 'low' },
];

// 안전 조치 가이드(가이드 표시용 — 앱 내 실행 없음)
export const safetyGuide: string[] = [
  '해당 서비스에 로그인해 비밀번호를 새로 설정합니다.',
  '같은 비밀번호를 쓰던 다른 서비스도 함께 변경합니다.',
  '가능하면 2단계 인증(2FA)을 활성화합니다.',
];

// 정리 대상: OAuth 연결 계정 중 6개월+ 미사용 상위 7개(리터럴 카운트 금지 — 산출)
export function deriveCleanupCandidates(list: Account[] = accounts): Account[] {
  return list
    .filter((a) => a.linkMethod.endsWith('-oauth') && a.unusedMonths >= 6)
    .sort((x, y) => y.unusedMonths - x.unusedMonths)
    .slice(0, 7);
}

export type RequestStatus = '요청됨' | '진행중' | '완료';
export type DeleteRequest = { id: string; service: string; status: RequestStatus; eta: string };

export const deleteRequests: DeleteRequest[] = [
  { id: 'r1', service: '싸이월드', status: '완료', eta: '처리 완료' },
  { id: 'r2', service: 'Quora', status: '진행중', eta: '3~5일' },
  { id: 'r3', service: 'Medium', status: '요청됨', eta: '접수 대기' },
  { id: 'r4', service: '카카오스토리', status: '요청됨', eta: '접수 대기' },
];

export function requestTone(status: RequestStatus): 'success' | 'warning' | 'neutral' {
  return status === '완료' ? 'success' : status === '진행중' ? 'warning' : 'neutral';
}

// 대시보드 지표(전부 데이터에서 산출)
export const overseasCount = accounts.filter((a) => a.category === 'overseas').length;
export const socialCount = accounts.filter((a) => a.category === 'social').length;
export const unusedCount = accounts.filter((a) => a.unusedMonths >= 12).length;
export const breachedCount = accounts.filter((a) => a.breached).length;
export const unresolvedBreachCount = breaches.filter((b) => !b.resolved).length;
export const cleanupCount = deriveCleanupCandidates().length;

export const privacyScore = derivePrivacyScore(accounts);
export const privacyGrade = deriveGrade(privacyScore);
export const scoreTrend = [48, 52, 54, privacyScore]; // 4주 추이(마지막 = 현재 산출 점수)
export const scoreDelta = privacyScore - scoreTrend[scoreTrend.length - 2];

// 위험 계정 수(유출 or 장기 미사용 = deriveRisk high). 리터럴 금지 — 산출.
export const highRiskCount = accounts.filter((a) => deriveRisk(a) === 'high').length;

// 월별 안전도 추이(최근 6개월) + 30대 또래 평균 벤치마크. 연출·예시.
// 내 라인 마지막 값은 현재 산출 점수(privacyScore)로 연결 — 하드코딩 아님.
export const monthlyLabels = ['2월', '3월', '4월', '5월', '6월', '7월'];
export const myMonthlyTrend = [46, 50, 54, 57, 60, privacyScore];
export const peerMonthlyAvg = [66, 67, 67, 68, 68, 69]; // 30대 또래 평균(예시값)

// 위험 분포(소셜/해외/미사용) — 비율 바용
export const riskBreakdown = [
  { label: '소셜 로그인', count: socialCount },
  { label: '해외 서비스', count: overseasCount },
  { label: '미사용 12개월+', count: unusedCount },
];

export type FeedItem = { id: string; text: string; when: string; tone: 'success' | 'warning' | 'error' | 'neutral' };
export const activityFeed: FeedItem[] = [
  { id: 'f1', text: 'Quora 유출 정황 발견', when: '2시간 전', tone: 'error' },
  { id: 'f2', text: '싸이월드 연결 해제 요청 완료', when: '어제', tone: 'success' },
  { id: 'f3', text: '계정 24개 스캔 완료', when: '어제', tone: 'neutral' },
  { id: 'f4', text: 'Spotify 12개월 미사용 감지', when: '3일 전', tone: 'warning' },
  { id: 'f5', text: '인터파크 유출 정황 발견', when: '4일 전', tone: 'error' },
];

export const currentUser = { name: '김민준' };

// ── hero 시각용(랜딩) — 원페이저 v5 hero 카드스택 재현. 전부 데이터에서 산출 ──
const riskWeight: Record<Risk, number> = { high: 2, medium: 1, low: 0 };

// 소셜 연결 계정 중 위험 상위 3 + 안전 3 (유출·고위험 우선 노출)
export function deriveHeroAccounts(list: Account[] = accounts): Account[] {
  const social = list.filter((a) => a.linkMethod.endsWith('-oauth'));
  const risky = social
    .filter((a) => deriveRisk(a) !== 'low')
    .sort((a, b) => riskWeight[deriveRisk(b)] - riskWeight[deriveRisk(a)])
    .slice(0, 3);
  const safe = social.filter((a) => deriveRisk(a) === 'low').slice(0, 3);
  return [...risky, ...safe];
}
export const heroAccounts = deriveHeroAccounts();

// 안전도 카운터: 현재(산출값) → 정리 후 목표(시연 연출값)
export const targetScore = 85;

// 소셜 로그인 배지(원페이저 chip-soc 재현). email-password는 배지 없음
export const socialBadge: Record<
  LinkMethod,
  { label: string; color: 'yellow' | 'gray' | 'green' } | null
> = {
  'kakao-oauth': { label: '카카오', color: 'yellow' },
  'google-oauth': { label: 'Google', color: 'gray' },
  'naver-oauth': { label: '네이버', color: 'green' },
  'apple-oauth': { label: 'Apple', color: 'gray' },
  'email-password': null,
};

// hero 위험 태그(사유 라벨 + 토큰 색) — 원본 필드에서 산출
export function deriveHeroTag(a: Account): { label: string; color: 'red' | 'yellow' | 'green' } {
  if (a.breached) return { label: '유출 노출', color: 'red' };
  const r = deriveRisk(a);
  if (r === 'high') return { label: '장기 미사용', color: 'red' };
  if (r === 'medium') return { label: '점검 필요', color: 'yellow' };
  return { label: '안전', color: 'green' };
}

// ── 브랜드 로고 메타(디자이너 정본 값 그대로) ──
// slug = simple-icons@13 아이콘. 없는 서비스(종료 등)는 이니셜만. onLight = 밝은 타일(글자·아이콘 어둡게).
export type BrandMeta = { slug?: string; color: string; initial: string; onLight?: boolean };
export const brandMeta: Record<string, BrandMeta> = {
  Gmail: { slug: 'gmail', color: '#EA4335', initial: 'G' },
  YouTube: { slug: 'youtube', color: '#FF0000', initial: 'Y' },
  'Google Drive': { slug: 'googledrive', color: '#4285F4', initial: 'GD' },
  'Google Photos': { slug: 'googlephotos', color: '#4285F4', initial: 'GP' },
  카카오톡: { slug: 'kakaotalk', color: '#FFCD00', initial: '카', onLight: true },
  카카오페이: { color: '#FFCD00', initial: '카', onLight: true },
  카카오스토리: { color: '#FFCD00', initial: '카', onLight: true },
  iCloud: { slug: 'icloud', color: '#3693F3', initial: 'I' },
  'Apple Music': { slug: 'applemusic', color: '#FA243C', initial: 'AM' },
  Netflix: { slug: 'netflix', color: '#E50914', initial: 'N' },
  Spotify: { slug: 'spotify', color: '#1ED760', initial: 'S', onLight: true },
  Amazon: { slug: 'amazon', color: '#FF9900', initial: 'A', onLight: true },
  Notion: { slug: 'notion', color: '#000000', initial: 'N' },
  Medium: { slug: 'medium', color: '#000000', initial: 'M' },
  Quora: { slug: 'quora', color: '#B92B27', initial: 'Q' },
  인터파크: { color: '#566072', initial: '인' },
  뽐뿌: { color: '#566072', initial: '뽐' },
  싸이월드: { color: '#566072', initial: '싸' },
  네이버: { slug: 'naver', color: '#03C75A', initial: '네' },
  쿠팡: { color: '#566072', initial: '쿠' },
  배달의민족: { color: '#566072', initial: '배' },
  토스: { color: '#566072', initial: '토' },
  멜론: { color: '#566072', initial: '멜' },
  '11번가': { color: '#566072', initial: '11' },
  LinkedIn: { slug: 'linkedin', color: '#0A66C2', initial: 'L' },
};

export function brandOf(service: string): BrandMeta {
  return brandMeta[service] ?? { color: '#566072', initial: service.slice(0, 1) };
}

// simple-icons CDN(디자이너 방식 그대로 — 다운로드·자가호스팅 안 함)
export function iconUrl(slug: string): string {
  return `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`;
}

// 디자이너 위험도 배지 클래스(low/mid/high) — deriveRisk 매핑
export function riskClass(r: Risk): 'low' | 'mid' | 'high' {
  return r === 'low' ? 'low' : r === 'medium' ? 'mid' : 'high';
}
