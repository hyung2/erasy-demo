// DB 전체 스냅샷을 JSON으로 받는다.
//
// 실행: pnpm exec tsx --env-file=.env scripts/backup-db.ts
//
// 왜 저장소 밖에 쓰는가
//   이 레포는 public이고, 스냅샷에는 사용자 이메일과 비밀번호 해시가 들어 있다.
//   워크스페이스 상위도 claude-config(git 추적)라 안전하지 않다. 그래서 홈 디렉터리
//   아래 별도 폴더에 쓴다. 경로를 하드코딩하지 않고 HOME에서 만든다(멀티 PC).
//
// 왜 비밀번호 해시를 빼지 않는가
//   백업의 목적은 원상복구다. 빼면 복구한 사용자가 로그인할 수 없어 반쪽짜리가 된다.
//   대신 파일이 저장소 밖에 있고, 이 스크립트는 내용을 표준출력으로 뱉지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * raw SELECT로 받는다. Prisma Client는 **스키마 파일 기준**으로 컬럼을 열거하므로,
 * 마이그레이션 직전(= 코드가 앞서 있고 DB가 뒤에 있는 시점)에 findMany를 쓰면
 * 아직 없는 컬럼을 조회하다 실패한다. 백업은 그 순간에 가장 필요한 도구인데
 * 하필 그때 못 쓰게 되는 셈이라, 있는 컬럼을 그대로 받는 방식이어야 한다.
 */
function dump(table: string): Promise<unknown[]> {
  return prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
}

async function main() {
  const [users, accounts, accessLogs, cleanupRequests, breaches, alerts, scoreSnapshots] =
    await Promise.all([
      dump('User'),
      dump('Account'),
      dump('AccessLog'),
      dump('CleanupRequest'),
      dump('Breach'),
      dump('Alert'),
      dump('ScoreSnapshot'),
    ]);

  const payload = {
    takenAt: new Date().toISOString(),
    counts: {
      users: users.length,
      accounts: accounts.length,
      accessLogs: accessLogs.length,
      cleanupRequests: cleanupRequests.length,
      breaches: breaches.length,
      alerts: alerts.length,
      scoreSnapshots: scoreSnapshots.length,
    },
    users,
    accounts,
    accessLogs,
    cleanupRequests,
    breaches,
    alerts,
    scoreSnapshots,
  };

  const dir = join(homedir(), 'Desktop', 'erasy-db-backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = join(dir, `erasy-prod-snapshot-${stamp}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');

  // 건수만 찍는다. 내용은 절대 표준출력으로 내보내지 않는다.
  console.log(`백업 완료: ${file}`);
  console.log(JSON.stringify(payload.counts));
}

main()
  .catch((e) => {
    console.error('백업 실패:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
