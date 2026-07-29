// 소셜 연결서비스 목록 가져오기 — 순수 파싱 로직(네트워크·DB 없음).
//
// 왜 붙여넣기인가: 구글·카카오·네이버 모두 "연결된 서비스" 목록을 외부 API로 열지 않는다
// (T1.1 스파이크 확정). 대신 하는 방법은 계정 위임인데 그건 약관·정보통신망법에서 깨진다.
// 그래서 사용자가 자기 계정 화면에서 목록을 복사해 오는 경로로 설계했다.
//
// 메일 스캔과 결정적으로 다른 점: 여기 온 이름은 **플랫폼이 준 사실**이지 우리가 발신 도메인에서
// 추론한 값이 아니다. 카탈로그에 없다고 버리면 대부분이 사라진다(실측 50건 중 다수가 카탈로그 밖).
// 카탈로그는 분류에만 쓰고, 목록 자체는 그대로 계정으로 인정한다.
//
// 정직성 한계
//  - 연결 목록에는 마지막 사용일이 없다 → lastUsedAt은 null(미상). 활동 신호를 지어내지 않는다.
//  - 분류를 모르는 서비스는 `unknown`으로 둔다. domestic/overseas를 임의로 찍지 않는다.
import { CATALOG } from './gmail-catalog';
import type { Category } from './dummy-data';

/** 저장 시 쓰는 분류. 카탈로그에 없으면 unknown. */
export type ImportCategory = Category | 'unknown';

export type ImportProvider = 'google' | 'kakao' | 'naver';

export type ParsedConnection = {
  /** 화면·저장에 쓰는 이름. 원문에서 앞뒤 공백만 정리한 값. */
  name: string;
  /** 같은 이름이 몇 줄 나왔는지. 구글은 클라이언트 단위라 같은 서비스가 여러 번 나온다. */
  occurrences: number;
  category: ImportCategory;
  /** 사용자가 빼는 게 나아 보이는 항목에 붙는 사유. 자동 제외는 하지 않는다. */
  warning?: string;
  /** 미리보기에서 기본 체크 여부. 경고가 있어도 기본은 켠다 — 참값을 임의로 버리지 않는다. */
  preselected: boolean;
};

export type ParseResult = {
  items: ParsedConnection[];
  /** 헤더·빈 줄 등 항목이 아니라고 판단해 넘긴 줄 수. 숨기지 않고 화면에 알린다. */
  ignoredLines: number;
  /** 중복으로 접힌 줄 수. */
  mergedDuplicates: number;
};

/** 목록이 아니라 화면 장식인 줄. 정확히 일치할 때만 버린다(참값 손실 방지). */
const HEADER_LINES = new Set([
  '조회 기준:',
  '조회기준:',
  '모든 연결 보기',
  '타사 앱 및 서비스',
  'Google 계정으로 로그인',
  '연결된 서비스',
  '연결된 앱',
]);

/** 우리 앱 자신. 인벤토리에 "이레이지"를 넣는 건 의미가 없어 기본 체크만 해제한다. */
const SELF_APP = new Set(['erasy', '이레이지', 'erasy-demo']);

/**
 * 서비스라기보다 사용자가 만든 OAuth 클라이언트·테스트 앱으로 보이는 패턴.
 * **거르지 않고 경고만 붙인다.** 자동 제외는 진짜 서비스를 같이 지울 위험이 있다
 * (2026-07-28 메일 스캔 교훈 — 필터를 세게 걸면 오탐이 미발견으로 바뀐다).
 */
const SUSPECT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^제목\s*없는/i, reason: '이름이 없는 프로젝트로 보입니다' },
  { re: /untitled/i, reason: '이름이 없는 프로젝트로 보입니다' },
  { re: /\b(preprod|staging|sandbox|dev|test|demo)\b/i, reason: '테스트·개발용 앱으로 보입니다' },
  { re: /localhost|127\.0\.0\.1/i, reason: '로컬 개발용으로 보입니다' },
];

/** 이름 대조용 정규화 — 공백 제거 + 소문자. 표시는 원문을 유지한다. */
function normalize(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/** 카탈로그에 있으면 그 분류를, 없으면 unknown. 추측하지 않는다. */
export function categoryOf(name: string): ImportCategory {
  const key = normalize(name);
  const hit = CATALOG.find(
    (e) => normalize(e.service) === key || (e.aliases ?? []).some((a) => normalize(a) === key),
  );
  return hit?.category ?? 'unknown';
}

function warningFor(name: string): string | undefined {
  return SUSPECT_PATTERNS.find(({ re }) => re.test(name))?.reason;
}

/**
 * 붙여넣은 텍스트 → 연결 서비스 목록.
 *
 * 형식 가정은 최소한만 둔다 — 한 줄에 서비스 하나, 빈 줄은 구분. 플랫폼마다 복사 결과가
 * 다르고 앞으로도 바뀌므로, 구조를 파고들기보다 "줄 단위로 받고 사용자가 확인"하는 쪽이 안전하다.
 */
export function parseConnectionList(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const byKey = new Map<string, ParsedConnection>();
  let ignoredLines = 0;
  let mergedDuplicates = 0;

  for (const rawLine of lines) {
    const name = rawLine.trim();
    if (!name) continue; // 빈 줄은 구분자일 뿐이라 세지 않는다

    if (HEADER_LINES.has(name) || /^[-—·•*]+$/.test(name)) {
      ignoredLines += 1;
      continue;
    }
    // 한 줄에 60자를 넘으면 목록 항목이 아니라 설명문일 가능성이 높다.
    if (name.length > 60) {
      ignoredLines += 1;
      continue;
    }

    const key = normalize(name);
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      mergedDuplicates += 1;
      continue;
    }

    const warning = warningFor(name);
    byKey.set(key, {
      name,
      occurrences: 1,
      category: categoryOf(name),
      warning,
      // 우리 앱만 기본 해제. 경고 항목도 기본은 켠 채 사용자 판단에 맡긴다.
      preselected: !SELF_APP.has(key),
    });
  }

  return {
    items: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    ignoredLines,
    mergedDuplicates,
  };
}

/**
 * 이미 인벤토리에 있는 이름을 걸러 신규만 남긴다.
 * 서비스명 대조는 메일 스캔과 같은 정규화 규칙을 쓴다(표기 흔들림 흡수).
 */
export function selectNewConnections(
  items: ParsedConnection[],
  inventoryServices: string[],
): { fresh: ParsedConnection[]; alreadyKnown: ParsedConnection[] } {
  const known = new Set(inventoryServices.map(normalize));
  const fresh: ParsedConnection[] = [];
  const alreadyKnown: ParsedConnection[] = [];
  for (const item of items) {
    if (known.has(normalize(item.name))) alreadyKnown.push(item);
    else fresh.push(item);
  }
  return { fresh, alreadyKnown };
}
