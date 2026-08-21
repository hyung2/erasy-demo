// HIBP Breached Account — 이 이메일이 어느 유출 사건에 포함됐는지 조회한다.
//
// 왜 유료 경로인가
//   무료로 열려 있는 것은 두 가지다. 비밀번호 해시 대조(lib/hibp.ts)와 유출 사건 카탈로그.
//   앞은 "이 비밀번호가 털렸나", 뒤는 "그 회사가 털렸나"까지만 답한다.
//   "내 계정이 털렸나"는 breachedaccount 뿐이고 그것만 유료다. E축 계수 정의가
//   *내 계정의 미해결 유출*이라 나머지 둘로는 그 자리를 채울 수 없다.
//
// 서버 전용
//   API 키가 붙는 요청이라 브라우저에서 부르지 않는다. Pwned Passwords와 반대인데,
//   그쪽은 키가 없고 원문 무접촉이 목적이라 브라우저가 직접 부르는 것이 오히려 안전했다.

const HIBP_BASE = 'https://haveibeenpwned.com/api/v3';
// HIBP는 User-Agent 없는 요청을 403으로 막는다(문서 명시). 서비스명을 밝힌다.
const USER_AGENT = 'Erasy-Account-Recovery';

/** HIBP 응답 원형 중 우리가 쓰는 필드만. 나머지는 받되 보지 않는다. */
export type HibpBreach = {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string; // YYYY-MM-DD
  DataClasses: string[];
  IsVerified: boolean;
  IsSpamList: boolean;
  IsMalware: boolean;
};

export type NormalizedBreach = {
  service: string; // 표시용 이름(Title)
  domain: string; // 계정 매칭 키. HIBP가 비워 두는 사건도 있다
  breachDate: Date;
  exposedFields: string[]; // 한글 정규화. score-v2가 '비밀번호' 원소를 직접 본다
  severity: 'high' | 'mid' | 'low';
  advice: string;
};

/**
 * DataClasses 한글 표기.
 *
 * 'Passwords' → '비밀번호'는 **점수 엔진과의 계약**이다. computeExposure가
 * exposedFields에 '비밀번호'가 있는지로 계수(0.35 vs 0.2)를 가르므로, 이 한 줄이
 * 바뀌면 유출 사건의 심각도가 조용히 절반이 된다. 사전을 손댈 때 그 사실을 기억할 것.
 *
 * 사전에 없는 값은 원문을 그대로 둔다. 지어낸 번역보다 영어가 정직하다.
 */
const FIELD_KO: Record<string, string> = {
  'Email addresses': '이메일',
  Passwords: '비밀번호',
  Usernames: '아이디',
  Names: '이름',
  'Phone numbers': '전화번호',
  'Physical addresses': '주소',
  'Dates of birth': '생년월일',
  'IP addresses': 'IP 주소',
  'Geographic locations': '지역',
  Genders: '성별',
  'Job titles': '직업',
  Employers: '직장',
  'Social media profiles': '소셜 계정',
  'Credit cards': '신용카드',
  'Partial credit card data': '신용카드 일부',
  'Security questions and answers': '보안 질문',
  'Password hints': '비밀번호 힌트',
  'Website activity': '이용 기록',
  Purchases: '구매 내역',
  'Private messages': '비공개 메시지',
  'Browser user agent details': '브라우저 정보',
  Bios: '자기소개',
  Avatars: '프로필 사진',
  'Spoken languages': '사용 언어',
  'Time zones': '시간대',
  'Account balances': '계좌 잔액',
  'Bank account numbers': '계좌번호',
  'Government issued IDs': '신분증 번호',
  'Historical passwords': '과거 비밀번호',
  'Auth tokens': '인증 토큰',
  'Device information': '기기 정보',
};

/** 신분증·금융처럼 되돌리기 어려운 항목. 비밀번호가 없어도 심각도를 올린다. */
const CRITICAL_FIELDS = new Set([
  '신용카드',
  '계좌번호',
  '신분증 번호',
  '보안 질문',
  '인증 토큰',
]);

export function toKoreanFields(dataClasses: string[]): string[] {
  return dataClasses.map((c) => FIELD_KO[c] ?? c);
}

export function decideSeverity(fields: string[]): 'high' | 'mid' | 'low' {
  if (fields.includes('비밀번호') || fields.some((f) => CRITICAL_FIELDS.has(f))) return 'high';
  // 이메일 하나만 샜다면 피싱 경로는 열리지만 직접 탈취는 아니다.
  if (fields.length <= 1) return 'low';
  return 'mid';
}

/**
 * 조치 안내. 무엇이 샜는지에 따라 사용자가 실제로 할 수 있는 행동이 다르다.
 * "보안에 유의하세요" 같은 문장은 쓰지 않는다 — 아무 행동도 지정하지 않는 말이다.
 */
function buildAdvice(fields: string[], service: string): string {
  if (fields.includes('비밀번호')) {
    return `${service}의 비밀번호를 바꾸고, 같은 비밀번호를 쓰는 다른 서비스도 함께 바꾸세요.`;
  }
  if (fields.some((f) => CRITICAL_FIELDS.has(f))) {
    return `${service}에서 결제 수단과 보안 질문을 다시 설정하고, 관련 기관에 확인하세요.`;
  }
  if (fields.includes('전화번호')) {
    return '이 정보를 앞세운 사칭 연락이 올 수 있습니다. 문자·전화로 오는 링크는 열지 마세요.';
  }
  return '이 주소로 오는 피싱 메일에 주의하고, 2단계 인증을 켜 두세요.';
}

/** 키 설정 여부. 값은 반환하지 않는다 — 호출부가 알아야 하는 건 "쓸 수 있나"뿐이다. */
export function isBreachLookupConfigured(): boolean {
  return Boolean(process.env.HIBP_API_KEY);
}

export class BreachLookupError extends Error {
  constructor(
    message: string,
    readonly kind: 'unconfigured' | 'unauthorized' | 'rate_limited' | 'upstream',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/**
 * 이메일 한 건의 유출 이력 조회.
 *
 * 404는 오류가 아니라 **"이력 없음"**이다. HIBP는 결과가 없을 때 200 + 빈 배열이 아니라
 * 404를 준다. 이걸 오류로 처리하면 "깨끗한 사람"이 전부 조회 실패로 보인다.
 */
export async function fetchBreachedAccount(email: string): Promise<NormalizedBreach[]> {
  const key = process.env.HIBP_API_KEY;
  if (!key) {
    throw new BreachLookupError('HIBP_API_KEY가 설정되지 않았습니다.', 'unconfigured');
  }

  const url = `${HIBP_BASE}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  const res = await fetch(url, {
    headers: { 'hibp-api-key': key, 'user-agent': USER_AGENT },
    // 유출 이력은 자주 바뀌지 않지만, 사용자가 "지금 대조한다"고 누른 것이므로 캐시하지 않는다.
    cache: 'no-store',
  });

  if (res.status === 404) return [];
  if (res.status === 401 || res.status === 403) {
    throw new BreachLookupError('HIBP 인증에 실패했습니다(키 확인 필요).', 'unauthorized');
  }
  if (res.status === 429) {
    const retry = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
    throw new BreachLookupError(
      '조회 한도에 걸렸습니다. 잠시 후 다시 시도하세요.',
      'rate_limited',
      Number.isFinite(retry) ? retry : undefined,
    );
  }
  if (!res.ok) {
    throw new BreachLookupError(`HIBP 응답 오류: ${res.status}`, 'upstream');
  }

  const raw = (await res.json()) as HibpBreach[];
  return raw.filter(keepAsAccountBreach).map(normalize);
}

/**
 * 계정 유출로 볼 사건만 남긴다.
 *
 * 스팸 목록과 악성코드 수집본은 "내 주소가 어딘가 명단에 있다"는 사실일 뿐 특정 서비스의
 * 계정이 뚫린 것이 아니다. 이걸 E축에 넣으면 가입한 적 없는 곳이 유출로 잡힌다 —
 * 08-20 네이버 오탐과 같은 종류의 잘못이고, 이 제품에서 오탐은 미발견보다 나쁘다.
 * 미검증(IsVerified=false) 사건도 제외한다. 확증되지 않은 건으로 점수를 깎지 않는다.
 */
export function keepAsAccountBreach(b: HibpBreach): boolean {
  return b.IsVerified && !b.IsSpamList && !b.IsMalware;
}

export function normalize(b: HibpBreach): NormalizedBreach {
  const fields = toKoreanFields(b.DataClasses ?? []);
  const service = b.Title || b.Name;
  return {
    service,
    domain: (b.Domain ?? '').toLowerCase(),
    // BreachDate는 YYYY-MM-DD. UTC 자정으로 고정해 시간대에 따라 하루가 밀리지 않게 한다.
    breachDate: new Date(`${b.BreachDate}T00:00:00.000Z`),
    exposedFields: fields,
    severity: decideSeverity(fields),
    advice: buildAdvice(fields, service),
  };
}
