// Gmail 스캔 — 순수 로직(네트워크 호출은 API 라우트가 담당).
//
// 하는 일: 메시지 메타데이터(From·Date)를 서비스별 "마지막 활동 추정일"로 접는다.
// 하지 않는 일: 본문 접근·저장. 헤더 두 개(From, Date)만 쓰고 원문은 어디에도 남기지 않는다.
//
// 추정의 성격(화면 라벨과 일치시킬 것): 수신일 = 활동 **추정치**. 실제 로그인일이 아니며
// 광고 메일만 받아도 최근값이 된다. 이 한계를 감추면 점수 신뢰 전체가 무너진다.
import {
  aliasesFor,
  matchSender,
  resolveOpenSender,
  type CatalogEntry,
} from './gmail-catalog';

export type MessageMeta = {
  /** From 헤더 원문. */
  from: string;
  /** 수신 시각(epoch ms). Gmail internalDate와 동일 단위. */
  receivedAt: number;
};

export type ScanHit = {
  service: string;
  // 개방 모드(A1)에서 카탈로그 밖 서비스는 분류를 모른다 → 'unknown'. domestic/overseas를
  // 임의로 찍지 않는다(connection-import와 동일 정책). Prisma Category에 이미 있는 값이다.
  category: CatalogEntry['category'] | 'unknown';
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
  /**
   * 개인 메일로 판단해 제외한 메일 수(예: `hong@naver.com`).
   * 숨기면 "네이버를 왜 못 찾았나"에 답할 수 없다 — 제외했다는 사실 자체가 판별 근거다.
   */
  excludedPersonal: number;
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
  let excludedPersonal = 0;

  for (const msg of messages) {
    const verdict = matchSender(msg.from);
    if (verdict.kind === 'invalid') continue;
    if (verdict.kind === 'unmatched') {
      unmatched.add(verdict.domain);
      continue;
    }
    // 개인 메일 도메인에서 온 사람 메일 — 서비스로 세지 않되 버렸다는 사실은 남긴다.
    if (verdict.kind === 'personal') {
      excludedPersonal += 1;
      continue;
    }

    const { entry, domain } = verdict;
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
  return { hits, unmatchedDomains: unmatched.size, excludedPersonal, scanned: messages.length };
}

function daysBetween(then: number, now: number): number {
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * 개방 모드 접기(A1) — 가입·인증 문구로 걸린 메일을 서비스별 최신 활동으로 접는다.
 *
 * `foldMessages`와 다른 점: **카탈로그 밖 발신 도메인을 버리지 않는다.** 카탈로그에 있으면
 * 표시명·분류를 사전에서 가져오고, 없으면 등록 가능 도메인을 그대로 후보명으로 둔다
 * (이름을 지어내지 않는다 — 사용자가 화면에서 고친다).
 *
 * `unmatchedDomains`는 이 모드에서 의미가 없다(버리는 도메인이 없다). 대신 카탈로그로
 * 이름을 확정하지 못한 건수를 `unnamed`로 돌려준다 — 사용자 확인이 필요한 양이다.
 */
export function foldOpenMessages(
  messages: MessageMeta[],
  now: number,
): ScanResult & { unnamed: number; excludedInfra: number; infraDomains: string[] } {
  const byService = new Map<string, ScanHit>();
  const infra = new Map<string, number>();
  let excludedPersonal = 0;
  let excludedInfra = 0;
  let unnamed = 0;

  for (const msg of messages) {
    const v = resolveOpenSender(msg.from);
    if (v.kind === 'invalid') continue;
    if (v.kind === 'personal') {
      excludedPersonal += 1;
      continue;
    }
    // 발송 대행 도메인 — 담지 않되 무엇을 걸렀는지는 남긴다.
    if (v.kind === 'infra') {
      excludedInfra += 1;
      infra.set(v.domain, (infra.get(v.domain) ?? 0) + 1);
      continue;
    }

    const service = v.kind === 'known' ? v.entry.service : v.name;
    // 분류를 모르는 서비스에 domestic/overseas를 임의로 찍지 않는다(connection-import와 동일 정책).
    const category: ScanHit['category'] = v.kind === 'known' ? v.entry.category : 'unknown';

    const existing = byService.get(service);
    if (!existing) {
      if (v.kind === 'discovered') unnamed += 1;
      byService.set(service, {
        service,
        category,
        domain: v.domain,
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
      existing.domain = v.domain;
    }
  }

  const hits = [...byService.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    hits,
    unmatchedDomains: 0, // 개방 모드에서는 카탈로그 밖이라고 버리지 않는다
    excludedPersonal,
    scanned: messages.length,
    unnamed,
    excludedInfra,
    // 많이 보낸 순 — 화면에 몇 곳만 예시로 보여주기 위함.
    infraDomains: [...infra.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
  };
}

/**
 * 스캔 결과를 기존 인벤토리와 대조해 (a) 새로 발견된 서비스 (b) 활동일이 갱신되는 서비스로 가른다.
 * 서비스명 대조는 표기 흔들림을 막기 위해 공백 제거·소문자 정규화 후 수행한다.
 *
 * 개명한 서비스는 과거 표기(alias)까지 대조한다. 안 그러면 인벤토리의 `Apple Music`과
 * 스캔이 찾은 `Apple 계정`이 서로 다른 계정으로 남아 같은 계정이 두 줄로 보인다.
 */
export function diffAgainstInventory(
  hits: ScanHit[],
  inventoryServices: string[],
): { discovered: ScanHit[]; updated: ScanHit[]; matchedNames: Map<string, string> } {
  const known = new Map(inventoryServices.map((name) => [normalizeName(name), name]));
  const discovered: ScanHit[] = [];
  const updated: ScanHit[] = [];
  /** 스캔 서비스명 → 인벤토리에 실제로 저장된 이름. 갱신 대상을 찾을 때 쓴다. */
  const matchedNames = new Map<string, string>();

  for (const hit of hits) {
    const candidates = [hit.service, ...aliasesFor(hit.service)];
    const found = candidates.map(normalizeName).find((key) => known.has(key));
    if (found) {
      updated.push(hit);
      matchedNames.set(hit.service, known.get(found)!);
    } else {
      discovered.push(hit);
    }
  }
  return { discovered, updated, matchedNames };
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}
