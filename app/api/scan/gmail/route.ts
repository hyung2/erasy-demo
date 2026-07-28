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

import { auth } from '@/auth';
import { CATALOG, queryFor } from '@/lib/gmail-catalog';
import { foldMessages, type MessageMeta } from '@/lib/gmail-scan';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
// 서비스별로 최신 1건만 필요하다. 메일함 전체를 훑지 않는 것이 속도와 최소수집 양쪽에 맞는다.
const LOOKBACK = 'newer_than:3y';

type ListResponse = { messages?: Array<{ id: string }> };
type MetaResponse = {
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

async function latestMessageFor(
  token: string,
  query: string,
  signal: AbortSignal,
): Promise<MessageMeta | null> {
  const listUrl = `${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(`(${query}) ${LOOKBACK}`)}`;
  const listRes = await fetch(listUrl, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!listRes.ok) throw new Error(`list ${listRes.status}`);

  const list = (await listRes.json()) as ListResponse;
  const id = list.messages?.[0]?.id;
  if (!id) return null;

  // 본문 제외 — 메타데이터 포맷 + 헤더 2종만 요청한다.
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

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return fail('로그인이 필요합니다.', 401);

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
      CATALOG.map((entry) => latestMessageFor(token, queryFor(entry), controller.signal)),
    );

    const messages: MessageMeta[] = [];
    let failed = 0;
    let unauthorized = false;

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value) messages.push(s.value);
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

    return Response.json({
      ok: true,
      data: {
        ...result,
        // 정직 표기용 — 조회하지 못한 서비스 수를 숨기지 않는다.
        catalogSize: CATALOG.length,
        failedQueries: failed,
      },
    });
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? '시간 초과' : (e as Error).message;
    console.error('[scan/gmail] failed:', msg); // 토큰은 로그에 남기지 않는다.
    return fail('메일함 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.', 502);
  } finally {
    clearTimeout(timer);
  }
}
