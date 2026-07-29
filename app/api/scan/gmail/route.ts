// POST /api/scan/gmail — 메일함 기반 계정 발견(T5.6).
//
// 토큰 취급(심사 방어 지점)
//  - 브라우저가 구글에서 직접 받은 액세스 토큰을 본문으로 1회 전달받는다.
//  - 서버는 이 요청 처리 동안만 메모리에 두고 **저장하지 않는다**(DB·쿠키·로그 어디에도).
//  - 스키마에 OAuthToken이 없는 이유와 같은 원칙(H3 결정). 로그에 토큰 값을 남기지 않는다.
//
// 접근 범위
//  - gmail.readonly로 읽되 **본문은 요청하지 않는다**. format=metadata + From/Date 헤더만.
//  - gmail.metadata scope는 검색(q) 자체가 막혀 있어 readonly가 불가피하다 — 발표에서 선제 언급 대상.
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';
import {
  CATALOG,
  candidateCountFor,
  matchSender,
  queryFor,
  type CatalogEntry,
} from '@/lib/gmail-catalog';
import { foldMessages, diffAgainstInventory, type MessageMeta, type ScanHit } from '@/lib/gmail-scan';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
// 서비스별로 최신 1건만 필요하다. 메일함 전체를 훑지 않는 것이 속도와 최소수집 양쪽에 맞는다.
// 예외: 개인 메일 도메인(naver.com·kakao.com)은 최신 1건이 지인 메일일 수 있어 여러 건을 훑는다.
const LOOKBACK = 'newer_than:3y';

type ListResponse = { messages?: Array<{ id: string }> };
type MetaResponse = {
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** 메시지 1건의 메타데이터(From·Date)만 가져온다. 본문은 요청하지 않는다. */
async function messageMeta(
  token: string,
  id: string,
  signal: AbortSignal,
): Promise<MessageMeta | null> {
  const metaUrl = `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Date`;
  const metaRes = await fetch(metaUrl, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!metaRes.ok) throw new Error(`get ${metaRes.status}`);

  const meta = (await metaRes.json()) as MetaResponse;
  const from = meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value;
  const receivedAt = Number(meta.internalDate);
  if (!from || !Number.isFinite(receivedAt)) return null;

  return { from, receivedAt };
}

/**
 * 서비스 한 곳의 "가장 최근 서비스 알림" 1건을 찾는다.
 *
 * 질의는 도메인 전체로 던지고 발신자 판정은 여기서 한다(이슈 #4). 개인 메일 도메인은
 * 최신순 후보를 훑다가 **처음 만나는 서비스 알림**을 채택하고, 그 앞에서 걸러낸 지인 메일 수를
 * 함께 돌려준다. 질의 자체를 발신 전용 주소로 좁히지 않는 이유는 목록에 없는 변종 주소를
 * 통째로 놓쳐 미발견이 되기 때문이다.
 */
async function latestServiceMessage(
  token: string,
  entry: CatalogEntry,
  signal: AbortSignal,
): Promise<{ message: MessageMeta | null; excludedPersonal: number }> {
  const limit = candidateCountFor(entry);
  const query = queryFor(entry);
  const listUrl = `${GMAIL}/messages?maxResults=${limit}&q=${encodeURIComponent(`(${query}) ${LOOKBACK}`)}`;
  const listRes = await fetch(listUrl, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!listRes.ok) throw new Error(`list ${listRes.status}`);

  const list = (await listRes.json()) as ListResponse;
  const ids = (list.messages ?? []).map((m) => m.id);

  let excludedPersonal = 0;
  for (const id of ids) {
    const meta = await messageMeta(token, id, signal);
    if (!meta) continue;

    const verdict = matchSender(meta.from);
    if (verdict.kind === 'service') return { message: meta, excludedPersonal };
    if (verdict.kind === 'personal') excludedPersonal += 1;
    // unmatched·invalid: 도메인으로 질의했는데 매칭이 안 된 예외 케이스 — 조용히 넘긴다.
  }
  return { message: null, excludedPersonal };
}

/**
 * 스캔 결과를 인벤토리에 반영한다. 이게 없으면 S축(방치 표면) 승격은 화면 장식에 그친다.
 *
 * 두 가지 안전장치
 *  - 기존 계정의 활동일은 **메일 추정치가 더 최신일 때만** 갱신한다. 실측·자가신고로 들어온
 *    최신 값을 오래된 메일 추정치로 덮으면 신호가 나빠진다.
 *  - 새로 발견한 계정은 `source: mail_scan` + `discovered: true`로 표시해 시드·직접입력과 섞이지 않게 한다.
 */
async function applyToInventory(userId: string, hits: ScanHit[]) {
  if (hits.length === 0) return { discoveredCount: 0, updatedCount: 0 };

  const existing = await prisma.account.findMany({
    where: { userId },
    select: { id: true, name: true, lastUsedAt: true },
  });

  const { discovered, updated, matchedNames } = diffAgainstInventory(
    hits,
    existing.map((a) => a.name),
  );

  const byName = new Map(existing.map((a) => [a.name.replace(/\s+/g, '').toLowerCase(), a]));

  let updatedCount = 0;
  for (const hit of updated) {
    // 개명한 서비스는 인벤토리에 저장된 옛 이름으로 찾아야 한다(Apple 계정 ← Apple Music).
    const storedName = matchedNames.get(hit.service) ?? hit.service;
    const row = byName.get(storedName.replace(/\s+/g, '').toLowerCase());
    if (!row) continue;
    const seenAt = new Date(hit.lastSeenAt);
    if (row.lastUsedAt && row.lastUsedAt >= seenAt) continue; // 더 최신 값은 보존
    await prisma.account.update({ where: { id: row.id }, data: { lastUsedAt: seenAt } });
    updatedCount += 1;
  }

  if (discovered.length > 0) {
    await prisma.account.createMany({
      data: discovered.map((hit) => ({
        userId,
        name: hit.service,
        // 메일로는 가입 방식을 알 수 없다 — provider를 추측하지 않고 manual로 둔다.
        provider: 'manual' as const,
        category: hit.category,
        source: 'mail_scan' as const,
        discovered: true,
        lastUsedAt: new Date(hit.lastSeenAt),
      })),
    });
  }

  return { discoveredCount: discovered.length, updatedCount };
}

export async function POST(req: Request) {
  // 세션만 보고 진행하면 User 행이 없을 때 insert가 FK에 걸려 502로 끝난다 — 재로그인을 안내한다.
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) return fail(sessionUser.message, sessionUser.status);

  let token: string;
  try {
    const body = (await req.json()) as { accessToken?: unknown };
    if (typeof body.accessToken !== 'string' || body.accessToken.length < 20) {
      return fail('메일 접근 권한을 다시 받아주세요.', 400);
    }
    token = body.accessToken;
  } catch {
    return fail('요청 형식이 올바르지 않습니다.', 400);
  }

  // 전체 스캔이 무한정 늘어지지 않게 상한을 건다. 남은 서비스는 부분 결과로 정직하게 보고한다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const settled = await Promise.allSettled(
      CATALOG.map((entry) => latestServiceMessage(token, entry, controller.signal)),
    );

    const messages: MessageMeta[] = [];
    let failed = 0;
    let unauthorized = false;
    // 후보를 훑으며 지인 메일로 판단해 제외한 건수 — 결과에 그대로 노출한다.
    let excludedPersonal = 0;

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value.message) messages.push(s.value.message);
        excludedPersonal += s.value.excludedPersonal;
      } else {
        failed += 1;
        if (String(s.reason?.message ?? '').includes('401')) unauthorized = true;
      }
    }

    // 전량 실패 + 401 = 토큰이 죽었거나 scope 미승인. 빈 결과를 "깨끗함"으로 오인시키지 않는다.
    if (unauthorized && messages.length === 0) {
      return fail('메일 접근 권한이 만료됐습니다. 다시 시도해 주세요.', 401);
    }

    const result = foldMessages(messages, Date.now());
    const applied = await applyToInventory(sessionUser.userId, result.hits);

    return Response.json({
      ok: true,
      data: {
        ...result,
        ...applied,
        // 후보 순회에서 거른 건수 + 접기 단계에서 거른 건수. 판별 근거라 합산해 노출한다.
        excludedPersonal: excludedPersonal + result.excludedPersonal,
        // 정직 표기용 — 조회하지 못한 서비스 수를 숨기지 않는다.
        catalogSize: CATALOG.length,
        failedQueries: failed,
      },
    });
  } catch (e) {
    const err = e as Error;
    const msg = err.name === 'AbortError' ? '시간 초과' : err.message;
    // 토큰은 로그에 남기지 않는다. 스택은 실패 지점 특정에 필요해 남긴다.
    console.error('[scan/gmail] failed:', msg, err.stack);
    // 로컬 개발에서만 사유를 화면까지 올린다 — prod는 일반 문구를 유지한다.
    const detail = process.env.NODE_ENV === 'development' ? ` [${msg}]` : '';
    return fail(`메일함 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.${detail}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
