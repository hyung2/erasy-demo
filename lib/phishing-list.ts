// 피싱 도메인 정적 대조 유틸(T5.5) — 서버 사이드. 참고 신호(점수 엔진 무접촉, R8).
//   출처: 한국인터넷진흥원_피싱사이트 URL (data.go.kr 15109780, 2023-12-31 기준).
//   축약본 data/phishing-domains.txt(도메인만·dedup)를 로드해 "도메인 → 등재 여부" 조회.
// 원칙: 점수 미반영(참고 경고 뱃지 전용) + "참고 신호(2023 기준)" 라벨 강제 + 매칭 0건도 정직.
//   자격증명 무저장 원칙 유지 — 공개 피싱 목록 대조만(사용자 데이터 외부 전송 없음).

import { readFileSync } from 'node:fs';
import path from 'node:path';

// 강제 라벨·메타 — 노출 UI가 반드시 병기해야 하는 출처·기준일.
export const PHISHING_LIST_META = {
  source: '한국인터넷진흥원_피싱사이트 URL',
  datasetId: '15109780',
  baseline: '2023-12-31', // 데이터 기준일(정적 스냅샷 — 최신 아님)
  label: '참고 신호 (2023 기준 데이터)', // 뱃지·경고 강제 라벨
  scoreImpact: 'none', // 점수 미반영(참고용)
} as const;

let cache: Set<string> | null = null;

function dataFilePath(): string {
  return path.join(process.cwd(), 'data', 'phishing-domains.txt');
}

// 축약본 로드(1회 캐시). 파일 미적재/빈 파일이면 빈 목록(매칭 0건 — 정직).
export function loadPhishingDomains(): Set<string> {
  if (cache) return cache;
  const set = new Set<string>();
  try {
    const raw = readFileSync(dataFilePath(), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const d = normalizeDomain(t);
      if (d) set.add(d);
    }
  } catch {
    // 파일 없음 → 빈 목록. 억지 매칭 만들지 않음.
  }
  cache = set;
  return set;
}

// URL/도메인 문자열 → 정규화 호스트(소문자, scheme·userinfo·포트·path·www·트레일링점 제거).
export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme://
  s = s.split(/[/?#]/)[0]; // path·query·fragment
  s = s.replace(/^[^@]*@/, ''); // userinfo@
  s = s.replace(/:\d+$/, ''); // :port
  s = s.replace(/^www\./, ''); // 앞 www.
  s = s.replace(/\.+$/, ''); // 트레일링 점
  return s || null;
}

// 순수 매칭(테스트·주입용) — 주어진 목록 기준 등재 여부.
export function isListed(input: string, set: Set<string>): boolean {
  const d = normalizeDomain(input);
  return d !== null && set.has(d);
}

// 모듈 로드 목록 기준 조회.
export function isPhishingListed(input: string): boolean {
  return isListed(input, loadPhishingDomains());
}

export function phishingListCount(): number {
  return loadPhishingDomains().size;
}

// ── 노출 지점(breach/scan 카드 배선용): 계정 도메인 배열 → 등재 매칭만 반환 ──
// 반환은 등재된 것만(매칭 0건이면 빈 배열 — 정직). 라벨·scoreImpact:none 강제 동봉.
export type PhishingFinding = {
  domain: string; // 정규화 도메인
  label: string; // 강제 참고 라벨
  baseline: string; // 데이터 기준일
};
export function checkDomains(inputs: string[]): PhishingFinding[] {
  const set = loadPhishingDomains();
  const seen = new Set<string>();
  const out: PhishingFinding[] = [];
  for (const raw of inputs) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d) || !set.has(d)) continue;
    seen.add(d);
    out.push({ domain: d, label: PHISHING_LIST_META.label, baseline: PHISHING_LIST_META.baseline });
  }
  return out;
}
