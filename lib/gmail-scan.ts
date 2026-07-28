// Gmail 스캔 — 순수 로직(네트워크 호출은 API 라우트가 담당).
//
// 하는 일: 메시지 메타데이터(From·Date)를 서비스별 "마지막 활동 추정일"로 접는다.
// 하지 않는 일: 본문 접근·저장. 헤더 두 개(From, Date)만 쓰고 원문은 어디에도 남기지 않는다.
//
// 추정의 성격(화면 라벨과 일치시킬 것): 수신일 = 활동 **추정치**. 실제 로그인일이 아니며
// 광고 메일만 받아도 최근값이 된다. 이 한계를 감추면 점수 신뢰 전체가 무너진다.
import { extractDomain, matchService, type CatalogEntry } from './gmail-catalog';

export type MessageMeta = {
  /** From 헤더 원문. */
  from: string;
  /** 수신 시각(epoch ms). Gmail internalDate와 동일 단위. */
  receivedAt: number;
};

export type ScanHit = {
  service: string;
  category: CatalogEntry['category'];
  domain: string;
  /** 가장 최근 수신 시각(epoch ms). */
  lastSeenAt: number;
  /** 기준 시각으로부터 경과 일수 — 방치 판정 입력. */
  lastSeenDays: number;
  /** 해당 서비스로 매칭된 메일 건수(신뢰도 참고용, 점수 입력 아님). */
  messageCount: number;
};

export type ScanResult = {
  hits: ScanHit[];
  /** 카탈로그에 없어 서비스로 환원하지 못한 도메인 수 — "발견 못 함"을 정직하게 드러내는 값. */
  unmatchedDomains: number;
  /** 스캔이 훑은 메시지 수. */
  scanned: number;
};

/**
 * 메시지 메타데이터 → 서비스별 최신 활동. 같은 서비스 여러 건은 최신 1건으로 접는다.
 * `now`를 주입받아 테스트가 시각에 흔들리지 않게 한다.
 */
export function foldMessages(messages: MessageMeta[], now: number): ScanResult {
  const byService = new Map<string, ScanHit>();
  const unmatched = new Set<string>();

  for (const msg of messages) {
    const domain = extractDomain(msg.from);
    if (!domain) continue;

    const entry = matchService(domain);
    if (!entry) {
      unmatched.add(domain);
      continue;
    }

    const existing = byService.get(entry.service);
    if (!existing) {
      byService.set(entry.service, {
        service: entry.service,
        category: entry.category,
        domain,
        lastSeenAt: msg.receivedAt,
        lastSeenDays: daysBetween(msg.receivedAt, now),
        messageCount: 1,
      });
      continue;
    }

    existing.messageCount += 1;
    if (msg.receivedAt > existing.lastSeenAt) {
      existing.lastSeenAt = msg.receivedAt;
      existing.lastSeenDays = daysBetween(msg.receivedAt, now);
      existing.domain = domain;
    }
  }

  const hits = [...byService.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return { hits, unmatchedDomains: unmatched.size, scanned: messages.length };
}

function daysBetween(then: number, now: number): number {
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * 스캔 결과를 기존 인벤토리와 대조해 (a) 새로 발견된 서비스 (b) 활동일이 갱신되는 서비스로 가른다.
 * 서비스명 대조는 표기 흔들림을 막기 위해 공백 제거·소문자 정규화 후 수행한다.
 */
export function diffAgainstInventory(
  hits: ScanHit[],
  inventoryServices: string[],
): { discovered: ScanHit[]; updated: ScanHit[] } {
  const known = new Set(inventoryServices.map(normalizeName));
  const discovered: ScanHit[] = [];
  const updated: ScanHit[] = [];

  for (const hit of hits) {
    if (known.has(normalizeName(hit.service))) updated.push(hit);
    else discovered.push(hit);
  }
  return { discovered, updated };
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}
