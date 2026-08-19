// POST /api/accounts/import — 소셜 연결서비스 목록 가져오기.
//
// 흐름: 사용자가 구글·카카오·네이버 계정 화면에서 목록을 복사 → 붙여넣기 → 미리보기에서
// 뺄 항목을 해제 → 여기로 확정 목록이 온다. 서버는 확정된 이름만 저장한다.
//
// 왜 이 경로인가: 3사 모두 연결앱 목록 API를 외부에 열지 않는다(T1.1 스파이크). 대안인
// 계정 위임은 약관·정보통신망법에서 깨진다. 사용자 주도 가져오기가 남는 유일한 합법 경로다.
//
// 메일 스캔과 다른 점
//  - 이름은 플랫폼이 준 사실이다 → 카탈로그에 없어도 저장한다.
//  - 어느 화면에서 가져왔는지 알므로 **provider를 추측이 아니라 사실로 기록**한다.
//  - 목록에 마지막 사용일이 없다 → lastUsedAt은 null(미상). 활동 신호를 지어내지 않는다.
//
// 사라진 항목도 사실이다(2026-08-19).
//   여기는 오래도록 목록에 **있는** 것만 봤다. 그런데 사용자가 제공사 화면에서 연결을 끊고
//   돌아와 다시 붙여넣으면, 끊긴 서비스는 목록에서 빠진 채로 온다. 그 빠짐은 "내가 끊었다"는
//   자가신고가 아니라 **플랫폼이 준 사실**이다 — 이 라우트가 이름·provider를 사실로 취급하는
//   근거와 정확히 같다. 그동안은 그걸 unchangedCount로 세고 버렸고, 그래서 정리 완료를
//   확인할 방법이 자가신고밖에 없었다.
//   판정은 하되 **확정은 하지 않는다**. 사용자가 목록을 일부만 복사해 오면 끊지 않은 것까지
//   사라진 것으로 보이기 때문이다. 후보만 돌려주고 확인은 화면에서 받는다(cleanup/mark).
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveSessionUser } from '@/lib/session-user';
import { categoryOf, type ImportProvider } from '@/lib/connection-import';

const PROVIDERS: ImportProvider[] = ['google', 'kakao', 'naver'];
/** 한 번에 받을 수 있는 상한. 화면에서 사용자가 확인한 목록이라 크게 잡되 무한은 아니다. */
const MAX_ITEMS = 300;

// names = 저장할 확정 목록(사용자가 체크 해제한 항목은 빠져 있다).
// allNames = 이번에 붙여넣은 **원본 전체**. 사라짐 판정은 반드시 이쪽으로 한다 —
//   names로 재면 사용자가 "안 담을래"로 체크만 해제한 서비스가 "끊긴 것"으로 둔갑한다.
//   생략되면 사라짐 판정 자체를 하지 않는다(조용히 잘못 판정하느니 안 한다).
type ImportRequest = { provider?: unknown; names?: unknown; allNames?: unknown };

function fail(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** 이름 대조 정규화 — 표기 흔들림(공백·대소문자) 흡수. 표시는 원문을 유지한다. */
const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();

type ExistingRow = {
  id: string;
  name: string;
  provider: string;
  source: string;
  cleanupRequests: { actionType: string; status: string }[];
};

/**
 * 이번 목록에서 사라진 계정 = 연결이 끊긴 것으로 보이는 후보.
 *
 * 좁게 잡는다. 넓게 잡으면 안 끊은 계정을 "정리 완료"로 몰아 점수를 부풀리는데,
 * 그건 이 제품이 가장 하면 안 되는 종류의 거짓말이다.
 *  - allNames(원본 전체)가 없으면 판정 자체를 하지 않는다.
 *  - 같은 provider만 본다. 카카오 목록을 붙여넣었다고 구글 연결이 사라진 건 아니다.
 *  - seed는 제외한다. 예시 데이터는 어느 목록에도 없으니 전부 사라진 것처럼 잡힌다.
 *  - 이미 정리 완료된 계정은 다시 묻지 않는다.
 */
function findMissing(
  existing: ExistingRow[],
  provider: string,
  allNames: string[] | null,
): Array<{ accountId: string; name: string }> {
  if (!allNames || allNames.length === 0) return [];
  const present = new Set(allNames.map(key));
  return existing
    .filter(
      (a) =>
        a.provider === provider &&
        a.source !== 'seed' &&
        !present.has(key(a.name)) &&
        !a.cleanupRequests.some(
          (c) =>
            (c.actionType === 'revoke' || c.actionType === 'delete') && c.status === 'done',
        ),
    )
    .map((a) => ({ accountId: a.id, name: a.name }));
}

export async function POST(req: Request) {
  const sessionUser = await resolveSessionUser();
  if (!sessionUser.ok) return fail(sessionUser.message, sessionUser.status);

  let provider: ImportProvider;
  let names: string[];
  let allNames: string[] | null = null;
  try {
    const body = (await req.json()) as ImportRequest;
    if (typeof body.provider !== 'string' || !PROVIDERS.includes(body.provider as ImportProvider)) {
      return fail('어느 계정에서 가져왔는지 알 수 없습니다.', 400);
    }
    provider = body.provider as ImportProvider;

    if (!Array.isArray(body.names)) return fail('가져올 목록이 없습니다.', 400);
    names = body.names
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && n.length <= 60);

    if (names.length === 0) return fail('가져올 항목을 하나 이상 선택해 주세요.', 400);
    if (names.length > MAX_ITEMS) return fail(`한 번에 ${MAX_ITEMS}개까지 가져올 수 있습니다.`, 400);

    if (Array.isArray(body.allNames)) {
      allNames = body.allNames
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
    }
  } catch {
    return fail('요청 형식이 올바르지 않습니다.', 400);
  }

  try {
    const existing = await prisma.account.findMany({
      where: { userId: sessionUser.userId },
      select: {
        id: true,
        name: true,
        provider: true,
        source: true,
        // 이미 정리 완료된 계정을 "또 사라졌다"고 다시 묻지 않기 위해 함께 읽는다.
        cleanupRequests: { select: { actionType: true, status: true } },
      },
    });
    const byName = new Map(existing.map((a) => [key(a.name), a]));

    const toCreate: string[] = [];
    const toUpgrade: string[] = []; // 이미 있지만 가입 방식이 미확인이던 계정
    for (const name of names) {
      const row = byName.get(key(name));
      if (!row) {
        toCreate.push(name);
        continue;
      }
      // 연결 목록은 "이 서비스를 이 소셜 계정으로 연결했다"는 사실이다.
      // 기존에 manual(=가입 방식 미확인)로 두었던 계정만 승격한다. 사용자가 명시한 값은 건드리지 않는다.
      if (row.provider === 'manual') toUpgrade.push(row.id);
    }

    if (toCreate.length > 0) {
      await prisma.account.createMany({
        data: toCreate.map((name) => ({
          userId: sessionUser.userId,
          name,
          provider, // 가져온 화면이 곧 가입 방식 — 추측이 아니다
          category: categoryOf(name), // 카탈로그에 없으면 unknown
          source: 'social_link' as const,
          discovered: true,
          lastUsedAt: null, // 연결 목록에는 활동일이 없다
        })),
      });
    }

    if (toUpgrade.length > 0) {
      await prisma.account.updateMany({ where: { id: { in: toUpgrade } }, data: { provider } });
    }

    return Response.json({
      ok: true,
      data: {
        provider,
        submitted: names.length,
        createdCount: toCreate.length,
        upgradedCount: toUpgrade.length,
        // 이미 같은 이름이 있고 가입 방식도 확정돼 있던 계정 — 아무것도 하지 않았음을 숨기지 않는다
        unchangedCount: names.length - toCreate.length - toUpgrade.length,
        // 지난번엔 이 provider 목록에 있었는데 이번엔 없는 계정 = 끊긴 것으로 보이는 후보.
        missing: findMissing(existing, provider, allNames),
      },
    });
  } catch (e) {
    const err = e as Error;
    console.error('[accounts/import] failed:', err.message, err.stack);
    const detail = process.env.NODE_ENV === 'development' ? ` [${err.message}]` : '';
    return fail(`가져오기에 실패했습니다. 잠시 후 다시 시도해 주세요.${detail}`, 502);
  }
}
