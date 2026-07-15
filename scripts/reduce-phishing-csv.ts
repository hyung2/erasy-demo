// 피싱 URL CSV 축약 스크립트(T5.5) — 원본 CSV → 도메인만 추출·dedup·정렬 → 축약본.
// 실행: pnpm exec tsx scripts/reduce-phishing-csv.ts <원본CSV경로> [출력경로]
//   출처: 한국인터넷진흥원_피싱사이트 URL (data.go.kr 15109780, 2023-12-31 기준).
//   원본은 로그인 필요·수MB — 커밋 금지. 이 스크립트 산출물(data/phishing-domains.txt)만 레포에.
// 인코딩 무관: 피싱 호스트는 ASCII라 URL 토큰 추출은 EUC-KR/UTF-8 불문 동작(latin1로 안전 판독).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeDomain } from '../lib/phishing-list';

function main(): void {
  const src = process.argv[2];
  if (!src) {
    console.error('usage: pnpm exec tsx scripts/reduce-phishing-csv.ts <원본.csv> [출력경로]');
    process.exit(1);
  }
  const out = process.argv[3] ?? path.join(process.cwd(), 'data', 'phishing-domains.txt');

  let text: string;
  try {
    // latin1: 바이트 무손실 판독(호스트는 ASCII이므로 인코딩 오판 영향 없음).
    text = readFileSync(src, 'latin1');
  } catch (e) {
    console.error('원본 CSV 읽기 실패:', (e as Error).message);
    process.exit(1);
  }

  // URL 토큰(스킴 유무 모두) 추출 후 도메인 정규화.
  const urlLike = /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:[:/?#][^\s",;]*)?/gi;
  const domains = new Set<string>();
  let rawTokens = 0;
  for (const m of text.matchAll(urlLike)) {
    rawTokens += 1;
    const d = normalizeDomain(m[0]);
    // 최소 유효성: 점 포함 + TLD 2자+ (헤더·잡토큰 배제)
    if (d && /\.[a-z]{2,}$/i.test(d)) domains.add(d);
  }

  const sorted = [...domains].sort();
  const header = [
    '# 피싱 도메인 축약본 — 한국인터넷진흥원_피싱사이트 URL (data.go.kr 15109780, 2023-12-31 기준)',
    `# 원본: ${path.basename(src)} · 추출 토큰 ${rawTokens} → 고유 도메인 ${sorted.length}`,
    `# 생성: reduce-phishing-csv.ts · 참고 신호(점수 미반영). 형식: 도메인 1줄 1개.`,
    '',
  ].join('\n');
  writeFileSync(out, header + sorted.join('\n') + '\n', 'utf8');
  console.log(`축약 완료: ${sorted.length}개 고유 도메인 → ${out} (원본 토큰 ${rawTokens})`);
}

main();
