// 회복 레버 실측 — 읽기 전용. DB에 쓰지 않는다.
//
// 묻는 것: "최약축이 0점인데, 제품이 사용자에게 무엇을 하라고 말하는가."
// 화면의 추천 액션은 scoreV2(rows).recommendedAction / expectedGains에서 나온다.
// 그 목록에 최약축을 올리는 레버가 실제로 들어 있는지, 대상이 몇 건인지 센다.
//
// 그리고 확인(acknowledge)을 레버로 쳤을 때 종합이 어디까지 가는지 함께 계산한다.
// 확인은 ActionType에 없어 엔진이 세지 않는다 — 그래서 rows를 복제해 직접 켠다.
// **DB의 acknowledgedAt은 건드리지 않는다**(무대 자산·비가역).
//
// 실행: pnpm exec tsx --env-file=.env scripts/probe-recovery-lever.ts
import { PrismaClient } from '@prisma/client';
import { getScoreForUser, queryAccounts, toRowV2 } from '../lib/score-service';
import { scoreV2, SCORE_V2_PARAMS } from '../lib/score-v2';


export {};

const prisma = new PrismaClient();

function w(s: string): number {
  return [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
}
function row(k: string, v: string): void {
  console.log(`  ${k}${' '.repeat(Math.max(0, 36 - w(k)))} ${v}`);
}

async function main(): Promise<void> {
  const email = process.argv[2] ?? null;
  const users = await prisma.user.findMany({
    select: { id: true, email: true, _count: { select: { accounts: true } } },
  });
  const stage = email
    ? users.find((u) => u.email === email)
    : users.sort((a, b) => b._count.accounts - a._count.accounts)[0];
  if (!stage) throw new Error('사용자가 없다');

  const s = await getScoreForUser(stage.id);

  console.log('\n[현재] 무대 계정');
  row('종합', `${s.score} (${s.grade})`);
  row('최약축', String(s.weakestAxis));


  console.log('\n[기대 상승 목록] — 화면 추천 액션의 원천');
  if (s.expectedGains.length === 0) console.log('  (비어 있다)');
  for (const g of s.expectedGains) {
    row(`${g.axis} / ${g.actionType}`, `대상 ${g.accountIndices.length}건 · +${g.expectedGain}`);
  }

  console.log('\n[회복 투영] 화면이 말하는 "정리하면 여기까지"');
  row('before → after', `${s.recovery.beforeComposite} → ${s.recovery.afterComposite}`);
  for (const k of s.recovery.axisKeys) {
    const b = s.recovery.beforeAxes[k];
    const a = s.recovery.afterAxes[k];
    row(
      k,
      `${b.measured ? Math.round(b.score ?? 0) : '미측정'} → ${a.measured ? Math.round(a.score ?? 0) : '미측정'}`,
    );
  }

  // 확인(acknowledge)만 켰을 때 — 프로덕션 매핑(toRowV2)을 그대로 태운다.
  // DB는 건드리지 않는다(acknowledgedAt은 비가역·무대 자산).
  const dbRows = await queryAccounts(stage.id);
  const rows = dbRows.map(toRowV2);
  // ctx도 프로덕션과 같게 채운다. 비우면 유출축이 미측정으로 떨어져 종합이 어긋난다.
  const [u, unlinked] = await Promise.all([
    prisma.user.findUnique({ where: { id: stage.id }, select: { breachCheckedAt: true } }),
    prisma.breach.findMany({
      where: { userId: stage.id, accountId: null, resolved: false },
      select: { exposedFields: true },
    }),
  ]);
  const ctx = {
    checked: u?.breachCheckedAt != null,
    unlinkedBreaches: unlinked.map((b) => ({
      passwordExposed: b.exposedFields.includes('비밀번호'),
    })),
  };
  const base = scoreV2(rows, ctx);
  const after = scoreV2(
    rows.map((r) => (r.discovered ? { ...r, acknowledged: true } : r)),
    ctx,
  );
  console.log('\n[확인 시뮬레이션] 발견 계정을 전부 확인했을 때 (DB 미변경)');
  row('종합', `${base.composite} → ${after.composite}`);
  row(
    'surface',
    `${Math.round(base.axes.surface.score ?? 0)} → ${Math.round(after.axes.surface.score ?? 0)}`,
  );

  // 삭제 대상 구성 — `discovered` 단독 조건을 빼면 대상이 몇 건으로 줄어드는지.
  // 화면의 "N개 계정에 적용돼요"가 이 수치다.
  const P = SCORE_V2_PARAMS;
  const stale = rows.filter(
    (r) => !r.removed && r.lastUsedDays !== null && r.lastUsedDays >= P.staleDays,
  ).length;
  const discOnly = rows.filter(
    (r) =>
      !r.removed &&
      r.discovered &&
      !(r.lastUsedDays !== null && r.lastUsedDays >= P.staleDays),
  ).length;
  console.log('\n[삭제 대상 구성] "방치 계정 정리하기"가 겨냥하는 것');
  row('방치·묵은 계정(실제 방치)', `${stale}건`);
  row('발견만으로 대상이 된 계정', `${discOnly}건`);
  row('discovered 조건 제거 시 대상', `${stale}건`);

  console.log('\n[미확인 발견 계정] surface 미인지 인자의 모수');
  const unacked = await prisma.account.count({
    where: { userId: stage.id, discovered: true, acknowledgedAt: null },
  });
  row('discovered ∧ 미확인', `${unacked}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
