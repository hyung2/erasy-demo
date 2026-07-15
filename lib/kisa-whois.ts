// KISA WHOIS 실연동 유틸(T5.2) — 서버 사이드 전용. 공공데이터포털 B551505.
//   도메인/IP 1건 조회 → 등록기관·국가 요약. 점수 엔진·파라미터 무접촉(R8).
// serviceKey는 process.env.KISA_WHOIS_SERVICE_KEY(값 미출력 — 로그·응답에 절대 노출 금지).
// 정책: 자격증명 무저장 원칙 유지 — WHOIS는 공개 등록정보만 다룸(PII 최소).
// 주의: 서버 컴포넌트/라우트에서만 import(브라우저 번들 유입 금지 — 키 노출 방지).

const KISA_WHOIS_BASE = 'http://apis.data.go.kr/B551505/whois';

export type WhoisQueryType = 'domain' | 'ip';

export type WhoisSummary = {
  ok: boolean; // resultCode 정상(0/00) 여부
  resultCode: string | null;
  resultMsg: string | null;
  query: string;
  queryType: WhoisQueryType;
  registrant: string | null; // 등록인
  registrar: string | null; // 등록대행자·등록기관
  country: string | null; // 국가
  rawLength: number; // 원문 길이(디버그용 — 원문 자체는 반환 안 함)
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? decodeEntities(s) : null;
}

// XML 폴백 추출(키 에러 OpenAPI_ServiceResponse 등 비-JSON 응답용).
function pickXml(raw: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<${n}>\\s*(?:<!\\[CDATA\\[)?([^<]*?)(?:\\]\\]>)?\\s*</${n}>`, 'i');
    const m = raw.match(re);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return null;
}

// data.go.kr 응답 → 요약. JSON 우선(escape 안전), 실패 시 XML 폴백.
// 성공 코드 result_code="10000"(KISA WHOIS). krdomain=국내(.kr), 그 외 국제 구조.
function parseSummary(raw: string, query: string, type: WhoisQueryType): WhoisSummary {
  let obj: unknown = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    obj = null;
  }

  const resp = (obj as { response?: Record<string, unknown> } | null)?.response;
  if (resp) {
    const result = (resp.result ?? {}) as Record<string, unknown>;
    const whois = (resp.whois ?? {}) as Record<string, unknown>;
    const kr = whois.krdomain as Record<string, unknown> | undefined;
    const intl = (whois.internationalDomain ?? whois.internatinal) as
      | Record<string, unknown>
      | undefined;
    const err = whois.error as Record<string, unknown> | undefined;

    const resultCode = str(result.result_code) ?? str(err?.error_code);
    const resultMsg = str(result.result_msg) ?? str(err?.error_msg);
    const ok = resultCode === '10000';

    let registrant: string | null = null;
    let registrar: string | null = null;
    let country: string | null = null;
    if (kr) {
      registrant = str(kr.regName) ?? str(kr.e_regName);
      registrar = str(kr.agency) ?? str(kr.e_agency);
      country = 'KR';
    } else if (intl) {
      registrant = str(intl.registrant) ?? str(intl.orgName) ?? str(intl.name);
      registrar = str(intl.registrar) ?? str(intl.registrarName) ?? str(intl.isp);
      country = str(intl.country) ?? str(intl.nationality) ?? str(intl.countryCode);
    }
    return {
      ok,
      resultCode,
      resultMsg,
      query,
      queryType: type,
      registrant,
      registrar,
      country,
      rawLength: raw.length,
    };
  }

  // 비-JSON(XML 키 에러 envelope 등) → 태그 폴백.
  const resultCode = pickXml(raw, ['result_code', 'resultCode', 'returnReasonCode']);
  return {
    ok: resultCode === '10000',
    resultCode,
    resultMsg: pickXml(raw, ['result_msg', 'resultMsg', 'returnAuthMsg', 'errMsg']),
    query,
    queryType: type,
    registrant: pickXml(raw, ['regName', 'registrant', 'e_regName']),
    registrar: pickXml(raw, ['agency', 'regHost', 'registrar', 'e_agency']),
    country: /krdomain/i.test(raw) ? 'KR' : pickXml(raw, ['country', 'nationality']),
    rawLength: raw.length,
  };
}

function buildUrl(op: string, key: string, query: string, encodeKey: boolean): string {
  // serviceKey 이중 인코딩 함정: 저장 형태(인코딩/디코딩)에 따라 한쪽만 인증 통과.
  //   나머지 파라미터만 URLSearchParams로 인코딩, 키는 부착 방식 분기 후 재시도.
  const params = new URLSearchParams({ query, answer: 'json', numOfRows: '1', pageNo: '1' });
  const keyPart = encodeKey ? encodeURIComponent(key) : key;
  return `${KISA_WHOIS_BASE}/${op}?serviceKey=${keyPart}&${params.toString()}`;
}

// 키 에러는 data.go.kr OpenAPI_ServiceResponse(XML) envelope로 옴 — 그때만 인코딩 재시도.
//   JSON 응답(정상 엔드포인트 도달)의 질의 에러(031 등)는 키 문제 아님 → 재시도 안 함.
function isKeyError(raw: string): boolean {
  return /SERVICE_KEY|SERVICE ERROR|NOT_REGISTERED|LIMITED_NUMBER|<returnReasonCode>(30|22|31|32|33)</i.test(
    raw,
  );
}

async function fetchWhois(op: string, key: string, query: string, encodeKey: boolean): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(buildUrl(op, key, query, encodeKey), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json, text/xml;q=0.9, */*;q=0.5' },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── 본체: 도메인/IP 1건 WHOIS 조회 ──
export async function lookupWhois(
  query: string,
  type: WhoisQueryType = 'domain',
): Promise<WhoisSummary> {
  const key = process.env.KISA_WHOIS_SERVICE_KEY;
  if (!key) {
    // 키 미설정 — 값이 아닌 사실만 노출.
    throw new Error('KISA_WHOIS_SERVICE_KEY not set');
  }
  const q = query.trim();
  if (!q) throw new Error('empty query');
  const op = type === 'ip' ? 'ip_address' : 'domain_name';

  // 1차: 키 원문 부착(대개 인코딩키 저장). 키 에러 envelope면 2차: 인코딩 재시도.
  let raw = await fetchWhois(op, key, q, false);
  if (isKeyError(raw)) {
    raw = await fetchWhois(op, key, q, true);
  }
  return parseSummary(raw, q, type);
}

// ── 연계 지점: breach 카드 → 서비스 도메인 WHOIS ──
// AccessLog는 IP 미보유(location="서울, KR"만) → WHOIS 조회 불가. 대신 유출 서비스 도메인을
//   조회해 "이 서비스가 어디에 등록됐는지(국가·기관)"를 카드에 보강(서버 계약 우선, FE는 후속).
// 주: KISA WHOIS domain_name은 .kr/한글 도메인 전용(result_code 10000). .com은 031 반환.
//   국내 유출 서비스(뽐뿌 등)는 .kr로 정상 조회. 해외(.com)는 정직하게 미지원(031) 표기됨.
const BREACH_DOMAIN: Record<string, string> = {
  뽐뿌: 'ppomppu.co.kr', // .co.kr — KISA WHOIS 정상 조회
  인터파크: 'interpark.com', // .com — 이 엔드포인트 미지원(031)
  Quora: 'quora.com', // .com — 미지원(031)
  LinkedIn: 'linkedin.com', // .com — 미지원(031)
};

export function domainForBreachService(service: string): string | null {
  return BREACH_DOMAIN[service] ?? null;
}

// 유출 서비스명으로 바로 WHOIS(카드 배선용 단일 진입점). 도메인 미매핑이면 null.
export async function whoisForBreachService(service: string): Promise<WhoisSummary | null> {
  const domain = domainForBreachService(service);
  if (!domain) return null;
  return lookupWhois(domain, 'domain');
}
