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
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

  // zip은 Windows 기본 bsdtar로. Node 기본 모듈에는 압축이 없고, 이것 때문에 의존성을
  // 늘리지 않는다.
  //
  // **PowerShell Compress-Archive를 쓰지 않는다.** 중첩 폴더 항목을 `icons\icon128.png`처럼
  // **역슬래시**로 적는다. ZIP 규격은 슬래시를 요구하고, macOS·리눅스에서 풀면 폴더가 아니라
  // 그 이름을 통째로 가진 파일 하나가 생긴다. manifest가 가리키는 icons/icon128.png가
  // 없으니 Chrome이 확장을 아예 못 올린다 — 심사위원 절반이 그 환경일 수 있다.
  // Windows에서 풀면 멀쩡해 보여서 만든 사람은 끝까지 모른다(2026-08-25 발견).
  //
  // 항목을 하나씩 넘기는 것은 `.` 로 넘길 때 붙는 `./` 접두사를 없애기 위해서다.
  const entries = readdirSync(OUT);
  execFileSync(
    'C:/Windows/System32/tar.exe',
    ['-a', '-c', '-f', ZIP, '-C', OUT, ...entries],
    { stdio: 'inherit' },
  );

  // 만든 zip을 되읽어 경로 구분자를 실측한다. 규격 위반은 눈으로 안 보인다.
  const listing = execFileSync('C:/Windows/System32/tar.exe', ['-tf', ZIP], { encoding: 'utf8' });
  const bad = listing.split('\n').filter((l) => l.includes('\\'));
  if (bad.length > 0) {
    throw new Error(`zip 항목에 역슬래시가 있습니다: ${bad.slice(0, 3).join(', ')}`);
  }
  console.log(`zip 항목 ${listing.trim().split('\n').length}건 · 경로 구분자 정상`);

  console.log(`\n${ZIP} — 이 파일을 웹스토어에 올립니다.`);
  console.log(`${OUT}/ — 내용 확인용. 개발용 ${SRC}/는 건드리지 않았습니다.`);
}

main();
