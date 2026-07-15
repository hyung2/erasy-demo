// GET /api/whois — KISA WHOIS 실조회(T5.2). 세션 게이트 뒤(인증 필수).
//   ?query=<도메인|IP>&type=domain|ip  또는  ?breachService=<유출 서비스명>(도메인 자동 매핑).
//   응답: 등록기관·국가 요약(WhoisSummary). serviceKey는 서버에서만 사용 — 응답에 미노출.
// 빌드타임 외부 호출 금지 → force-dynamic. 점수 엔진 무접촉(R8).
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import type { ApiEnvelope } from '@/lib/api-types';
import {
  lookupWhois,
  whoisForBreachService,
  type WhoisSummary,
  type WhoisQueryType,
} from '@/lib/kisa-whois';

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const breachService = sp.get('breachService');
  const query = sp.get('query');
  const type: WhoisQueryType = sp.get('type') === 'ip' ? 'ip' : 'domain';

  try {
    let summary: WhoisSummary | null;
    if (breachService) {
      // 연계 지점: 유출 서비스 카드 → 서비스 도메인 WHOIS.
      summary = await whoisForBreachService(breachService);
      if (!summary) {
        return Response.json(
          { error: `no domain mapping for breach service: ${breachService}` },
          { status: 404 },
        );
      }
    } else if (query) {
      summary = await lookupWhois(query, type);
    } else {
      return Response.json({ error: 'query or breachService required' }, { status: 400 });
    }

    const body: ApiEnvelope<WhoisSummary> = { data: summary };
    return Response.json(body);
  } catch (e) {
    // 키 미설정·타임아웃·외부 장애 → 502(민감값 미노출, 사유 문자열만).
    const msg = (e as Error).message;
    console.warn('[api/whois] lookup failed:', msg);
    return Response.json({ error: `whois lookup failed: ${msg}` }, { status: 502 });
  }
}

// 배선 참고(FE 후속): breach 카드에서 아래로 호출.
//   fetch(`/api/whois?breachService=${encodeURIComponent(service)}`)
//   lib/kisa-whois의 domainForBreachService로 매핑 존재 여부 사전 판별(버튼 노출 조건).
