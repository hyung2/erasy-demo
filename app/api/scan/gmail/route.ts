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
import { openScanQuery, OPEN_SCAN_PHRASES } from '@/lib/gmail-catalog';
import { foldOpenMessages, diffAgainstInventory, type MessageMeta, type ScanHit } from '@/lib/gmail-scan';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
// 조회 창은 3년 유지. 5년으로 넓히면 휴면(730일+) 계정 비중이 급증해 점수가 과하게 내려가고
// 기존 측정과 비교할 수 없게 된다(2026-08-04 레드팀 조건).
const LOOKBACK = 'newer_than:3y';
// 한 번에 훑을 메시지 상한. 넘치면 잘랐다는 사실을 결과에 그대로 노출한다(조용한 절단 금지).
//   180으로 뒀을 때 실계정 첫 시도에서 바로 걸렸다 — 카탈로그 36을 없앤 자리에 새 상한이
//   들어앉는 셈이라 올렸다(2026-08-04 실측).
const MAX_MESSAGES = 500;
// list 한 페이지 크기. Gmail은 최대 500까지 받지만 페이지를 나눠야 중단 지점을 잡을 수 있다.
const PAGE_SIZE = 250;
// metadata 동시 호출 수 — Gmail rate limit과 시간 예산 사이의 타협.
const CONCURRENCY = 10;
// 전체 abort(25s)보다 앞서 스스로 멈추는 지점. 여기서 끊으면 부분 결과를 정직하게 돌려줄 수
// 있지만, abort에 걸리면 통째로 502가 되어 사용자가 아무것도 못 본다.
const SOFT_BUDGET_MS = 18_000;

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
 * 가입·인증 문구로 걸린 메시지 id를 모은다(A1 개방 모드).
 *
 * 이전 구조는 카탈로그 36개 서비스마다 `from:도메인` 질의를 하나씩 던졌다. 그래서 찾을 수 있는
 * 서비스의 상한이 목록 크기에 하드코딩돼 있었고, 실계정 측정에서 6곳만 발견되고 질의 9건이
 * 실패했다(2026-08-04). 이제 질의를 1회로 줄이고 판정을 발신 도메인 집계로 옮긴다.
 */
async function listSignupMessages(
  token: string,
  signal: AbortSignal,
  deadline: number,
): Promise<{ ids: string[]; truncated: boolean }> {
  const q = `(${openScanQuery()}) ${LOOKBACK}`;
  const ids: string[] = [];
  let pageToken: string | undefined;

  // nextPageToken을 따라간다. 페이지를 안 넘기면 첫 페이지가 곧 발견 상한이 되고,
  // "다시 스캔하면 이어서 찾습니다"는 지킬 수 없는 약속이 된다(같은 질의 → 같은 첫 페이지).
  do {
    const want = Math.min(PAGE_SIZE, MAX_MESSAGES - ids.length);
    if (want <= 0) break;
    const url =
      `${GMAIL}/messages?maxResults=${want}&q=${encodeURIComponent(q)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal });
    if (!res.ok) throw new Error(`list ${res.status}`);

    const body = (await res.json()) as ListResponse & { nextPageToken?: string };
    for (const m of body.messages ?? []) ids.push(m.id);
    pageToken = body.nextPageToken;
  } while (pageToken && ids.length < MAX_MESSAGES && Date.now() < deadline);

  // 더 남았는데 우리가 멈춘 경우에만 truncated다.
  return { ids, truncated: Boolean(pageToken) };
}

/**
 * 메시지 메타데이터를 제한 동시성으로 모은다.
 * 시간 예산을 넘기면 남은 건을 포기하고 **포기했다는 사실을 함께 돌려준다** — 조용히 줄이면
 * 사용자는 그게 전부인 줄 안다.
 */
async function collectMeta(
  token: string,
  ids: string[],
  signal: AbortSignal,
  deadline: number,
): Promise<{ messages: MessageMeta[]; failed: number; unauthorized: boolean; skipped: number }> {
  const messages: MessageMeta[] = [];
  let failed = 0;
  let unauthorized = false;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      if (Date.now() > deadline) break;
      const i = cursor++;
      try {
        const m = await messageMeta(token, ids[i], signal);
        if (m) messages.push(m);
      } catch (e) {
        failed += 1;
        if (String((e as Error).message).includes('401')) unauthorized = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  const processed = Math.min(cursor, ids.length);
  return { messages, failed, unauthorized, skipped: Math.max(0, ids.length - processed) };
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
    const deadline = Date.now() + SOFT_BUDGET_MS;
    const { ids, truncated } = await listSignupMessages(token, controller.signal, deadline);
    const { messages, failed, unauthorized, skipped } = await collectMeta(
      token,
      ids,
      controller.signal,
      deadline,
    );

    // 전량 실패 + 401 = 토큰이 죽었거나 scope 미승인. 빈 결과를 "깨끗함"으로 오인시키지 않는다.
    if (unauthorized && messages.length === 0) {
      return fail('메일 접근 권한이 만료됐습니다. 다시 시도해 주세요.', 401);
    }

    const result = foldOpenMessages(messages, Date.now());
    const applied = await applyToInventory(sessionUser.userId, result.hits);

    return Response.json({
      ok: true,
      data: {
        ...result,
        ...applied,
        // 정직 표기용 — 무엇을 몇 건 훑었고 무엇을 못 했는지 숨기지 않는다.
        phraseCount: OPEN_SCAN_PHRASES.length,
        listed: ids.length,
        truncated, // 질의에 더 남았는데 상한·시간에서 멈췄는가
        maxMessages: MAX_MESSAGES,
        skipped, // 목록에 있었으나 시간 예산으로 확인하지 못한 건수
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
