// 개발 결과 보고서에 넣을 수치를 실제로 센다 — 읽기 전용.
//
// 실행: pnpm exec tsx scripts/report-metrics.ts
//
// 왜 스크립트로 세는가: 보고서 숫자를 손으로 적으면 그날의 기억이 굳는다. 다음에 고쳐 쓸 때
// 무엇이 달라졌는지 알 수 없고, 틀려도 틀린 줄 모른다. 세는 방법을 남기면 다시 셀 수 있다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

export {};

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.css']);
const SKIP_DIR = new Set(['node_modules', '.next', '.git', '.vercel', 'extension-dist']);

type Bucket = { files: number; lines: number };

function walk(dir: string, onFile: (p: string) => void): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p, onFile);
    } else onFile(p);
  }
}

function count(paths: string[]): Bucket {
  return paths.reduce(
    (acc, p) => ({
      files: acc.files + 1,
      lines: acc.lines + readFileSync(p, 'utf8').split('\n').length,
    }),
    { files: 0, lines: 0 },
  );
}

function main(): void {
  const all: string[] = [];
  walk('.', (p) => {
    // 백업본은 세지 않는다 — 같은 코드를 두 번 세면 규모가 부풀려진다.
    if (p.includes('.bak-')) return;
    if (CODE_EXT.has(extname(p))) all.push(p.replace(/\\/g, '/').replace(/^\.\//, ''));
  });

  const group = (pred: (p: string) => boolean): Bucket => count(all.filter(pred));

  const app = group((p) => p.startsWith('app/'));
  const lib = group((p) => p.startsWith('lib/'));
  const comp = group((p) => p.startsWith('components/'));
  const scripts = group((p) => p.startsWith('scripts/'));
  const ext = group((p) => p.startsWith('extension/'));

  const apiRoutes = all.filter((p) => /^app\/api\/.*route\.ts$/.test(p)).length;
  const pages = all.filter((p) => /^app\/.*page\.tsx$/.test(p)).length;
  const guards = all.filter((p) => /^scripts\/verify-.*\.ts$/.test(p) && !p.includes('verify-all')).length;

  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const models = (schema.match(/^model \w+/gm) ?? []).length;
  const enums = (schema.match(/^enum \w+/gm) ?? []).length;
  const migrations = readdirSync('prisma/migrations').filter((d) =>
    statSync(join('prisma/migrations', d)).isDirectory(),
  ).length;

  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
  const first = execFileSync('git', ['log', '--format=%cd', '--date=short'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .slice(-1)[0];
  const last = execFileSync('git', ['log', '-1', '--format=%cd', '--date=short'], {
    encoding: 'utf8',
  }).trim();
  const days = Math.round(
    (new Date(last).getTime() - new Date(first).getTime()) / 86_400_000,
  );

  const rows: [string, string][] = [
    ['기간', `${first} ~ ${last} (${days}일)`],
    ['커밋', `${commits}건`],
    ['화면(page.tsx)', `${pages}개`],
    ['API 라우트', `${apiRoutes}개`],
    ['DB 모델 / enum', `${models}개 / ${enums}개`],
    ['마이그레이션', `${migrations}건`],
    ['app/', `${app.files}파일 ${app.lines.toLocaleString()}줄`],
    ['lib/', `${lib.files}파일 ${lib.lines.toLocaleString()}줄`],
    ['components/', `${comp.files}파일 ${comp.lines.toLocaleString()}줄`],
    ['extension/', `${ext.files}파일 ${ext.lines.toLocaleString()}줄`],
    ['scripts/ (검증·도구)', `${scripts.files}파일 ${scripts.lines.toLocaleString()}줄`],
    ['검증 스크립트', `${guards}종`],
    [
      '제품 코드 합계',
      `${(app.files + lib.files + comp.files + ext.files)}파일 ` +
        `${(app.lines + lib.lines + comp.lines + ext.lines).toLocaleString()}줄`,
    ],
  ];

  const w = Math.max(...rows.map(([k]) => [...k].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
  for (const [k, v] of rows) {
    const kw = [...k].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
    console.log(`${k}${' '.repeat(w - kw)}  ${v}`);
  }
}

main();
