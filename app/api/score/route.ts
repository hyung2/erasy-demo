// GET /api/score — 프라이버시 점수/등급/추이 실구현(T4.3 v2 다차원 전환).
// 신호 집계·엔진 계산·ScoreSnapshot append는 lib/score-service(단일 경로), 산식 정본은
// 03-step02-mvp/score-spec-v2-multidim.md. coverage는 점수 보정 아닌 정직 표기(확인된 N개 기준).
// H2: 세션 게이트 필수. 빌드타임 DB 접속 금지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import type { ApiEnvelope, ScoreDTO } from '@/lib/api-types';
import { getScoreForUser } from '@/lib/score-service';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 소유권 경계: 세션 userId 소속 계정만 집계(쿼리 where 스코핑 — IDOR 차단).
  const result = await getScoreForUser(userId);

  const data: ScoreDTO = {
    score: result.score,
    grade: result.grade,
    delta: result.delta,
    trend: result.trend,
    trendPoints: result.trendPoints,
    coverage: result.coverage,
    coveredCount: result.coveredCount,
    // v2 additive — 기존 필드 shape 불변, 신규 4축·최약축·기대상승만 추가
    axes: result.axes,
    weakestAxis: result.weakestAxis,
    expectedGains: result.expectedGains,
  };

  const body: ApiEnvelope<ScoreDTO> = { data };
  return Response.json(body);
}
