// GET /api/score — 프라이버시 점수/등급/추이 (stub: dummy-data 파생, _stub:true).
// W3: userId 신호 집계 → lib/score.computePrivacyScore(W3 산식) + ScoreSnapshot 시계열로 교체.
// 지금은 산식 미확정이라 dummy-data.derivePrivacyScore 표시값을 사용한다(정직 표기).
// H2: 세션 게이트 필수. 빌드타임 실행 방지 → force-dynamic.
export const dynamic = 'force-dynamic';

import { auth } from '@/auth';
import type { ApiEnvelope, ScoreDTO } from '@/lib/api-types';
import {
  accounts,
  privacyScore,
  privacyGrade,
  scoreDelta,
  scoreTrend,
} from '@/lib/dummy-data';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const data: ScoreDTO = {
    score: privacyScore,
    grade: privacyGrade,
    delta: scoreDelta,
    trend: scoreTrend,
    coverage: 1, // 데모: 전 계정 확인 가정. W2: coveredCount/total 실산출
    coveredCount: accounts.length,
  };

  const body: ApiEnvelope<ScoreDTO> = { data, _stub: true };
  return Response.json(body);
}
