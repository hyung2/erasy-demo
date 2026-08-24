// 웹스토어 제출용 확장 패키지를 만든다.
//
// 실행: pnpm exec tsx scripts/build-extension.ts
//   → extension-dist/ 폴더 + extension-dist.zip
//
// 개발용 manifest를 그대로 올리지 않는 이유: content_scripts에 http://localhost/*가 들어
// 있다. 개발에는 필요하지만 심사에서는 **쓰지 않는 권한**이고, 사용자에게는 "이 확장이 내
// 로컬 서버도 읽는다"로 보인다. 개인정보 보호를 파는 제품이 필요 이상을 요구하면 그 자체가
// 모순이다.
//
// 개발용 파일을 직접 고치지 않고 사본을 만든다. 고쳤다가 되돌리는 것을 잊으면 그날부터
// 로컬에서 확장이 조용히 죽는다.
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = 'extension';
const OUT = 'extension-dist';
const ZIP = 'extension-dist.zip';

/** 심사에 올리지 않는 대상. 개발 편의를 위한 것만 걷어낸다. */
const DEV_ONLY_MATCHES = [/^http:\/\/localhost/, /^http:\/\/127\.0\.0\.1/];

type Manifest = {
  version: string;
  content_scripts?: { matches: string[] }[];
  host_permissions?: string[];
  permissions?: string[];
};

function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(SRC, OUT, { recursive: true });

  const path = join(OUT, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;

  const removed: string[] = [];
  for (const cs of manifest.content_scripts ?? []) {
    cs.matches = cs.matches.filter((m) => {
      const dev = DEV_ONLY_MATCHES.some((re) => re.test(m));
      if (dev) removed.push(m);
      return !dev;
    });
  }

  // 심사에서 가장 흔히 걸리는 자리 — 매칭이 하나도 안 남으면 확장이 아무 데서도 안 돈다.
  const remaining = (manifest.content_scripts ?? []).flatMap((c) => c.matches);
  if (remaining.length === 0) {
    throw new Error('content_scripts 매칭이 모두 제거됐습니다. prod 도메인이 빠졌는지 확인하십시오.');
  }

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`버전 ${manifest.version}`);
  console.log(`제거한 개발용 매칭 ${removed.length}건${removed.length ? `: ${removed.join(', ')}` : ''}`);
  console.log(`남은 매칭: ${remaining.join(', ')}`);
  console.log(`권한: ${(manifest.permissions ?? []).join(', ') || '없음'}`);
  console.log(`호스트 권한 ${(manifest.host_permissions ?? []).length}건`);

  // zip은 PowerShell로. Node 기본 모듈에는 압축이 없고, 이것 때문에 의존성을 늘리지 않는다.
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}/*' -DestinationPath '${ZIP}' -Force`],
    { stdio: 'inherit' },
  );
  console.log(`\n${ZIP} — 이 파일을 웹스토어에 올립니다.`);
  console.log(`${OUT}/ — 내용 확인용. 개발용 ${SRC}/는 건드리지 않았습니다.`);
}

main();
