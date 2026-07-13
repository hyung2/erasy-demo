// GET /api/guard — 실시간 가드(알림 피드 + 유출 이력) (stub: dummy-data 파생, _stub:true).
// W4: userId 스코프 Alert/Breach 조회 + HIBP 실조회로 교체. shape는 GuardDTO 고정.
// H2: 세션 게이트 필수. 빌드타임 실행 방지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import type {
  ApiEnvelope,
  GuardDTO,
  AlertDTO,
  BreachDTO,
} from '@/lib/api-types';
import { activityFeed, breaches, type FeedItem } from '@/lib/dummy-data';

// 데모 피드 tone → Alert type 파생(유출/점수하락/재정리)
function toAlertType(f: FeedItem): AlertDTO['type'] {
  if (f.tone === 'error') return 'breach';
  if (f.tone === 'warning') return 'score_drop';
  return 'recleanup';
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const alerts: AlertDTO[] = activityFeed.map((f) => ({
    id: f.id,
    type: toAlertType(f),
    message: f.text,
    when: f.when,
    tone: f.tone,
  }));

  const breachList: BreachDTO[] = breaches.map((b) => ({
    id: b.id,
    service: b.service,
    breachDate: b.breachDate,
    exposedFields: b.exposedFields,
    advice: b.advice,
    severity: b.severity,
    resolved: b.resolved,
  }));

  const data: GuardDTO = { alerts, breaches: breachList };
  const body: ApiEnvelope<GuardDTO> = { data, _stub: true };
  return Response.json(body);
}
