// 소셜 연결목록 파서 픽스처 — 네트워크·DB 없이 도는 회귀 가드.
// 실행: pnpm exec tsx scripts/connection-import.test.ts
//
// 입력은 2026-07-29 사용자 실계정(구글 연결 서비스)에서 복사한 실물이다. 가공하지 않았다.
// 여기서 지키려는 것
//  - 헤더·빈 줄을 항목으로 세지 않는다
//  - 같은 이름 중복(구글은 클라이언트 단위로 준다)은 한 건으로 접힌다
//  - 카탈로그 밖 서비스도 버리지 않는다 — 플랫폼이 준 사실이지 우리 추론이 아니다
//  - 의심 항목은 경고만 붙고 자동으로 사라지지 않는다(참값 손실 0)
import { parseConnectionList, selectNewConnections, categoryOf } from '../lib/connection-import';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!ok) failures += 1;
}

// 실물 붙여넣기(구글 계정 > 타사 앱 및 서비스 > 모든 연결 보기)
const REAL_PASTE = `조회 기준:

Adobe

Airbnb

Atlassian

BurnFit: Gym & Workout Planner

ChatGPT

Claude by Anthropic

Claude for Google Calendar

Claude for Google Calendar

Clerk

Cloudflare Dashboard

Data Studio

DeeVid：AI Video Generator

Docker

erasy

Figma

Gabia

Gemini Code Assist and Gemini CLI

Genspark

GitHub

Google AI Studio

Google Antigravity

HIKO Social Login

HoverNotes

Kaggle

Kingshot

Kiro

Last War:Survival Game

Linear

LinkedIn: Community & Network

Louis Vuitton App Preprod

MiriCanvas

Neon Console

Notion Calendar

Notion Calendar

Opal

OpenAI

Perplexity

Perplexity AI

Pinterest

Reddit

SecondB

Slack

Slack

Smithery

variant-web

Vercel

Wanted: Jobs & Career

Wine-Searcher

World of Airports™

X

YouTube on TV

제목 없는 프로젝트`;

const r = parseConnectionList(REAL_PASTE);

// ── (a) 파싱 총량 ──
// 원문 항목 52줄 중 완전 중복 3건(Claude for Google Calendar·Notion Calendar·Slack) → 49건
check('a1 헤더 제외', r.ignoredLines === 1, `${r.ignoredLines}줄 무시 (기대 1 — "조회 기준:")`);
check('a2 중복 병합 수', r.mergedDuplicates === 3, `${r.mergedDuplicates}건 (기대 3)`);
check('a3 최종 항목 수', r.items.length === 49, `${r.items.length}건 (기대 49)`);

// ── (b) 중복 접기 ──
const dupNames = ['Claude for Google Calendar', 'Notion Calendar', 'Slack'];
for (const n of dupNames) {
  const hit = r.items.filter((i) => i.name === n);
  check(
    `b  "${n}" 1건으로 접힘`,
    hit.length === 1 && hit[0].occurrences === 2,
    `${hit.length}건 · occurrences=${hit[0]?.occurrences}`,
  );
}
// 유사하지만 다른 이름은 병합하지 않는다 — 플랫폼이 다른 클라이언트로 준 것이라 임의 병합은 왜곡이다.
check(
  'b4 유사명은 별개 유지',
  r.items.some((i) => i.name === 'Perplexity') && r.items.some((i) => i.name === 'Perplexity AI'),
  'Perplexity · Perplexity AI 둘 다 존재',
);

// ── (c) 카탈로그 밖도 살아남는다 ──
const outsiders = ['Docker', 'Neon Console', 'Kaggle', 'Linear', 'Figma'];
for (const n of outsiders) {
  check(`c  카탈로그 밖 "${n}" 보존`, r.items.some((i) => i.name === n), '존재');
}
check('c6 카탈로그 밖은 unknown 분류', categoryOf('Docker') === 'unknown', categoryOf('Docker'));

// ── (d) 카탈로그 매칭은 분류를 채운다 ──
check('d1 Airbnb → overseas', categoryOf('Airbnb') === 'overseas', categoryOf('Airbnb'));
check('d2 Pinterest 미등록 → unknown', categoryOf('Pinterest') === 'unknown', categoryOf('Pinterest'));
check('d3 X → social(카탈로그 별칭)', categoryOf('X (Twitter)') === 'social', categoryOf('X (Twitter)'));

// ── (e) 경고는 붙되 사라지지 않는다 ──
const untitled = r.items.find((i) => i.name === '제목 없는 프로젝트');
check('e1 이름없는 프로젝트 보존', untitled !== undefined, untitled ? '존재' : '사라짐');
check('e2 경고 부착', Boolean(untitled?.warning), String(untitled?.warning));
check('e3 기본 체크 유지', untitled?.preselected === true, `preselected=${untitled?.preselected}`);

const preprod = r.items.find((i) => i.name === 'Louis Vuitton App Preprod');
check('e4 Preprod 경고', Boolean(preprod?.warning), String(preprod?.warning));
check('e5 Preprod도 기본 체크', preprod?.preselected === true, `preselected=${preprod?.preselected}`);

// ── (f) 자기 앱만 기본 해제 ──
const self = r.items.find((i) => i.name === 'erasy');
check('f1 erasy 보존', self !== undefined, self ? '존재' : '사라짐');
check('f2 erasy 기본 해제', self?.preselected === false, `preselected=${self?.preselected}`);

// ── (g) 인벤토리 대조 ──
// 인벤토리 쪽 표기가 흔들려도(공백 다름) 같은 서비스로 인식해야 중복 계정이 안 생긴다.
const { fresh, alreadyKnown } = selectNewConnections(r.items, ['Airbnb', 'Neon  Console', 'Netflix']);
check(
  'g1 기존 계정 제외',
  alreadyKnown.some((i) => i.name === 'Airbnb'),
  alreadyKnown.map((i) => i.name).join(','),
);
check('g2 신규는 남음', fresh.some((i) => i.name === 'Docker'), `${fresh.length}건 신규`);
check(
  'g3 공백 표기 흔들림 흡수',
  alreadyKnown.some((i) => i.name === 'Neon Console'),
  `"Neon  Console"(공백 2개)와 동일 취급 — alreadyKnown=${alreadyKnown.map((i) => i.name).join(',')}`,
);

// ── (h) 빈 입력·잡음 ──
const empty = parseConnectionList('\n\n   \n');
check('h1 빈 입력', empty.items.length === 0, `${empty.items.length}건`);
const noisy = parseConnectionList('조회 기준:\n---\nGitHub\n' + 'x'.repeat(80));
check('h2 긴 설명문 무시', noisy.items.length === 1 && noisy.items[0].name === 'GitHub', `${noisy.items.length}건`);

console.log(failures === 0 ? '\nconnection-import: 전 항목 PASS' : `\nconnection-import: ${failures}건 FAIL`);
process.exit(failures === 0 ? 0 : 1);
