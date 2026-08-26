// 가드 전체를 한 번에 돌리고 표로 보고한다.
//
// 실행:
//   pnpm exec tsx --env-file=.env scripts/verify-all.ts             # static + db
//   pnpm exec tsx --env-file=.env scripts/verify-all.ts --all       # 외부망·서버·prod까지
//   pnpm exec tsx --env-file=.env scripts/verify-all.ts --tier=static
//
// 왜 러너가 필요한가: 가드가 30종을 넘어서면 "무엇을 돌렸는지"가 사람 기억에 의존한다.
// 기억에 의존하면 방금 고친 것만 돌리게 되고, 그 옆에서 깨진 것은 다음 사람이 만난다.
//
// **계층은 grep으로 추론하지 않고 아래 표에 적는다.** 추론은 새 가드가 생겼을 때 조용히
// 틀린 계층으로 분류하고, 틀린 계층은 실행에서 빠지며, 빠진 것은 통과처럼 보인다.
// (실제로 이 파일의 첫 판에서 `../lib/prisma`를 거쳐 DB를 치는 가드 11종을 순수로 잘못
//  분류했다. import 한 줄 차이였고, 표를 눈으로 채우고 나서야 드러났다.)
//
// 판정 — 아래를 **모두** 만족해야 통과다.
//   1) 종료 코드 0
//   2) 실패로 읽히는 줄이 0건
//   3) 통과로 읽힌 검사가 1건 이상
// 3번이 필요한 이유: 가드가 시작 직후 던지거나 대상을 하나도 찾지 못하면 검사를 0건 수행한
// 것인데 실패도 0건이라 통과와 구분되지 않는다. 아무것도 재지 않은 것은 통과가 아니다.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

export {};

type Tier = 'static' | 'db' | 'net' | 'server' | 'prod';

/**
 * 계층 표. 여기에 없는 verify-*.ts는 실행되지 않고 "미분류"로 보고된다(조용히 빠지지 않는다).
 *   static  아무 자원도 필요 없다 — 순수 함수와 소스 스캔
 *   db      Neon에 픽스처를 만들고 지운다. **prod와 같은 DB**이므로 순차 실행한다
 *   net     외부 API를 친다 (HIBP·KISA whois). 상대 사정으로 실패할 수 있다
 *   server  **격리 DB + 그 DB에 물린 로컬 서버**가 있어야 한다. 이 계층은 사용자를 만들고
 *           지우므로 prod DB에서 돌리면 안 되고, 실제로 가드 스스로 localhost가 아니면
 *           멈춘다. 띄우는 법:
 *             docker run -d --name erasy-qa-pg -e POSTGRES_USER=qa -e POSTGRES_PASSWORD=qa \
 *               -e POSTGRES_DB=erasy_qa -p 55434:5432 postgres:16
 *             (스크래치 디렉터리에 schema+migrations를 복사하고 그쪽 .env로 migrate deploy —
 *              Prisma CLI는 프로젝트 .env가 셸 환경변수를 덮으므로 같은 폴더에서 돌리면
 *              prod Neon으로 간다. 2026-08-25 실측)
 *             DATABASE_URL=postgresql://qa:qa@localhost:55434/erasy_qa?sslmode=disable \
 *               AUTH_TRUST_HOST=1 AUTH_URL=http://localhost:3020 npx next start -p 3020
 *           Next는 셸 환경변수를 .env보다 우선하므로 export만으로 갈린다(Prisma CLI와 반대).
 *           띄운 뒤 BASE_URL=http://localhost:3020으로 이 계층을 돌린다.
 *   prod    배포된 주소를 친다
 */
const TIERS: Record<string, Tier> = {
  'verify-btn-variant': 'static',
  'verify-breach-lookup': 'static',
  'verify-chart-axis': 'static',
  'verify-csp-hosts': 'static',
  'verify-no-synthetic-api': 'static',
  'verify-risk-alert': 'static',
  'verify-service-registry': 'static',
  'verify-service-wiring': 'static',
  'verify-surface-measured': 'static',
  'verify-selfreport-payload': 'static',
  'verify-axis-visibility': 'static',

  'verify-account-deletion': 'db',
  'verify-acknowledge': 'db',
  'verify-breach-count-consistency': 'db',
  'verify-cleanup-queue': 'db',
  'verify-connection-import': 'db',
  'verify-credentials-auth': 'db',
  'verify-empty-start': 'server',
  'verify-gmail-apply': 'db',
  'verify-idor-2user': 'server',
  'verify-login-provision': 'db',
  'verify-provision': 'db',
  'verify-recovery-projection': 'db',
  'verify-revoke-roundtrip': 'server',
  'verify-score-db': 'db',
  'verify-score-db-v2': 'db',
  'verify-selfreport-gate': 'server',
  'verify-service-aggregate': 'db',
  'verify-service-backfill': 'db',
  'verify-session-guard': 'db',

  'verify-hibp': 'net',
  'verify-whois': 'net',

  'verify-deletion-e2e': 'server',
  'verify-after-login': 'server',

  'verify-prod-health': 'prod',
  'verify-prod-surface-measured': 'prod',
  'verify-prod-selfreport': 'prod',
};

/**
 * 일괄 실행에 넣지 않는 검사와 그 이유. 값이 이유인 것이 중요하다 — 이유 없이 빼면
 * 다음 사람이 "왜 안 도는지" 모른 채 넘어가고, 그때부터 그 검사는 없는 것이 된다.
 */
const MANUAL = new Map<string, string>([
  ['verify-judge-login', '심사용 계정 자격증명을 인자로 받는다 — 제출 직전 수동 실행'],
]);

/**
 * 판정을 내지 않는 점검 스크립트. 이름만 verify-*이고 상태를 찍은 뒤 늘 성공으로 끝난다.
 * "무슨 자원이 필요한가"(Tier)와 "판정을 내는가"는 서로 다른 속성이라 필드를 나눈다.
 * 여기 있는 것은 통과로도 실패로도 세지 않는다 — 판정 없는 것을 통과로 세면 합계가 실제보다
 * 든든해 보이고, 든든해 보이는 합계는 아무도 다시 들여다보지 않는다.
 */
const NO_VERDICT = new Set(['verify-score-db', 'verify-whois']);

const TIER_ORDER: Tier[] = ['static', 'db', 'net', 'server', 'prod'];
const TIMEOUT_MS = 180_000;

type Result = {
  name: string;
  tier: Tier;
  ok: boolean;
  checks: number;
  failed: number;
  ms: number;
  note: string;
};

/**
 * 가드마다 결과를 적는 방식이 다르다 — 네 가지가 섞여 있다.
 *   `이름: N passed, M failed` · `이름: N assertions passed` · 줄마다 `PASS`/`FAIL` · `N/M PASS`
 * 하나로 통일하는 편이 옳지만 그건 동작하는 검증 코드 열다섯 개를 데모 사흘 전에 고치는
 * 일이다. 여기서는 네 형식을 모두 읽고, **어느 것으로도 안 읽히면 통과로 세지 않는다.**
 */
function parse(out: string): { checks: number; failed: number; recognized: boolean } {
  const summary = out.match(/:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
  if (summary) return { checks: Number(summary[1]), failed: Number(summary[2]), recognized: true };

  const assertions = out.match(/:\s*(\d+)\s*assertions passed/);
  if (assertions) return { checks: Number(assertions[1]), failed: 0, recognized: true };

  const ratio = out.match(/(\d+)\/(\d+)\s*PASS/);
  if (ratio) {
    const pass = Number(ratio[1]);
    const total = Number(ratio[2]);
    return { checks: total, failed: total - pass, recognized: true };
  }

  const lines = out.split('\n');
  const pass = lines.filter((l) => /(^|\s)PASS(\s|$)/.test(l)).length;
  const fail = lines.filter((l) => /(^|\s)FAIL(\s|$)/.test(l)).length;
  if (pass + fail > 0) return { checks: pass + fail, failed: fail, recognized: true };

  return { checks: 0, failed: 0, recognized: false };
}

function runOne(name: string, tier: Tier, extraArgs: string[]): Promise<Result> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      ['node_modules/tsx/dist/cli.mjs', `scripts/${name}.ts`, ...extraArgs],
      { shell: false, env: process.env },
    );

    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));

    const timer = setTimeout(() => {
      child.kill();
      resolve({ name, tier, ok: false, checks: 0, failed: 0, ms: Date.now() - started, note: '시간 초과' });
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      const { checks, failed, recognized } = parse(out);

      // 점검 스크립트는 판정이 없다. 종료 코드만 보고 통과·실패 집계에서는 뺀다.
      if (NO_VERDICT.has(name)) {
        resolve({
          name, tier, ok: code === 0, checks: 0, failed: 0, ms,
          note: code === 0 ? '판정 없음(점검용) — 실행만 확인' : `종료 코드 ${code}`,
        });
        return;
      }

      if (!recognized) {
        const last = out.trim().split('\n').slice(-1)[0] ?? '(출력 없음)';
        resolve({ name, tier, ok: false, checks: 0, failed: 0, ms, note: `결과 형식 미인식 — ${last.slice(0, 80)}` });
        return;
      }

      let note = '';
      if (checks === 0) note = '검사 0건 — 아무것도 재지 않았다';
      else if (failed > 0)
        note = out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join(' / ').slice(0, 110);
      else if (code !== 0) note = `실패 줄은 없는데 종료 코드가 ${code}`;

      resolve({ name, tier, ok: code === 0 && failed === 0 && checks > 0, checks, failed, ms, note });
    });
  });
}

function pad(s: string, n: number): string {
  // 한글은 두 칸을 먹는다. 폭을 문자 수로 세면 표가 어긋난다.
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const only = args.find((a) => a.startsWith('--tier='))?.split('=')[1] as Tier | undefined;
  const base = args.find((a) => a.startsWith('http'));

  // 디스크에 있는데 표에 없는 가드를 먼저 드러낸다.
  const onDisk = readdirSync('scripts')
    .filter((f) => f.startsWith('verify-') && f.endsWith('.ts') && f !== 'verify-all.ts')
    .map((f) => f.replace(/\.ts$/, ''));
  const unlisted = onDisk.filter((n) => !(n in TIERS) && !MANUAL.has(n));
  if (unlisted.length > 0) {
    console.log(`\n미분류 가드 ${unlisted.length}종 — 계층 표에 없어 실행되지 않는다:`);
    unlisted.forEach((n) => console.log(`  ${n}`));
  }
  const manualHere = onDisk.filter((n) => MANUAL.has(n));
  if (manualHere.length > 0) {
    console.log(`\n수동 실행 ${manualHere.length}종:`);
    manualHere.forEach((n) => console.log(`  ${n} — ${MANUAL.get(n)}`));
  }

  const tiers = only ? [only] : all ? TIER_ORDER : (['static', 'db'] as Tier[]);
  const results: Result[] = [];

  for (const tier of tiers) {
    const names = onDisk.filter((n) => TIERS[n] === tier).sort();
    if (names.length === 0) continue;
    console.log(`\n── ${tier} (${names.length}종) ──`);
    for (const name of names) {
      // server 계층 일부는 주소를 인자로 받고(verify-deletion-e2e), 일부는 BASE_URL 환경변수로
      // 받는다. 인자를 안 넘기면 기본 포트로 붙었다가 "fetch failed"로 죽는데, 그 문구는
      // 서버가 없다는 뜻으로 읽혀 원인을 엉뚱한 곳에서 찾게 된다.
      const target = tier === 'prod' ? base : tier === 'server' ? (base ?? process.env.BASE_URL) : undefined;
      const extra = target ? [target] : [];
      const r = await runOne(name, tier, extra);
      results.push(r);
      console.log(
        `  ${r.ok ? 'PASS' : 'FAIL'}  ${pad(name, 34)} ${String(r.checks).padStart(3)}건 ` +
          `${String(r.ms).padStart(6)}ms  ${r.note}`,
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  const checks = results.reduce((a, r) => a + r.checks, 0);
  console.log(
    `\n합계: 가드 ${results.length}종 · 검사 ${checks}건 · 실패 가드 ${failed.length}종` +
      (only || all ? '' : ' (net·server·prod 제외 — 전체는 --all)'),
  );
  if (failed.length > 0) {
    console.log('\n실패:');
    failed.forEach((r) => console.log(`  ${r.name} — ${r.note || `${r.failed}건 실패`}`));
    process.exitCode = 1;
  }
}

main();
