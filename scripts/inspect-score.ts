// 특정 사용자의 현재 점수를 화면과 같은 경로로 계산해 출력한다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/inspect-score.ts <이메일>
//
// /api/score와 같은 함수(getScoreForUser)를 부른다. 화면에서 읽은 숫자와 여기 숫자가
// 다르면 둘 중 하나가 틀린 것이지 "환경 차이"가 아니다.
//
// 읽기 전용. 다만 getScoreForUser는 조회할 때 점수 스냅샷을 한 줄 남기므로(추이용),
// 실행 횟수만큼 ScoreSnapshot이 늘어난다는 점은 알고 쓸 것.
import { prisma } from '../lib/prisma';
import { getScoreForUser } from '../lib/score-service';
import type { AxisKey } from '../lib/score-v2';

const AXES: AxisKey[] = ['exposure', 'surface', 'hygiene', 'threat'];
const AXIS_KO: Record<AxisKey, string> = {
  exposure: '유출',
  surface: '방치',
  hygiene: '위생',
  threat: '이상접속',
};

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('이메일을 인자로 주세요: inspect-score.ts <이메일>');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, breachCheckedAt: true },
  });
  if (!user) throw new Error(`사용자를 찾을 수 없습니다: ${email}`);

  const [accounts, breaches, unresolved, pendingCleanup] = await Promise.all([
    prisma.account.count({ where: { userId: user.id } }),
    prisma.breach.count({ where: { userId: user.id } }),
    prisma.breach.count({ where: { userId: user.id, resolved: false } }),
    prisma.cleanupRequest.count({ where: { userId: user.id, status: { not: 'done' } } }),
  ]);

  const s = await getScoreForUser(user.id);

  console.log(`대상: ${user.email}`);
  console.log(
    `계정 ${accounts} · 유출 ${breaches}(미해결 ${unresolved}) · 정리 대기 ${pendingCleanup}`,
  );
  console.log(`유출 대조: ${user.breachCheckedAt?.toISOString() ?? '없음'}`);
  console.log('');
  console.log(`종합 ${s.score ?? '미측정'} (${s.grade ?? '-'})`);
  for (const k of AXES) {
    const a = s.axes[k];
    const value = a.measured && a.score !== null ? a.score.toFixed(1) : '미측정';
    console.log(
      `  ${AXIS_KO[k].padEnd(5)} ${String(value).padStart(8)}  coverage ${a.coverage.toFixed(2)}` +
        (a.topFinding ? `  — ${a.topFinding}` : ''),
    );
  }
  console.log('');
  console.log(
    `회복 투영: ${s.recovery.beforeComposite ?? '-'} → ${s.recovery.afterComposite ?? '-'}`,
  );
}

main()
  .catch((e) => {
    console.error('실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
