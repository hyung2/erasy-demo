// CSP 정책이 코드가 실제로 끌어오는 외부 호스트를 덮는지 — 소스 스캐닝, 읽기 전용.
//
// 실행: pnpm exec tsx scripts/verify-csp-hosts.ts
//
// 왜: CSP 위반은 **그 경로를 밟아야** 관측된다. Gmail 스캔은 버튼을 눌러야 Google Identity
// Services를 받아 오는데, 화면을 훑는 관측에서는 그 클릭이 없어 위반이 0건으로 보였다.
// 정책에 없는 채로 enforce로 올렸다면 데모 핵심 기능이 그 자리에서 깨졌을 것이다
// (2026-08-24 발견). 밟지 않아도 잡히려면 소스에서 세어야 한다.
//
// 두 가지를 세지 않는다.
//   서버 코드 — CSP는 브라우저 정책이라 서버가 부르는 외부는 무관하다.
//   <a href>  — 사용자를 다른 사이트로 보내는 내비게이션이다. 정책에 navigate-to가 없으므로
//               제한되지 않는다. 섞어 세면 필요 없이 정책을 넓히게 되고, "혹시 몰라 열어 둔
//               항목"이 쌓이면 정책이 있으나 마나가 된다.
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL ${msg}`);
  }
}

const URL_RE = /https:\/\/([a-z0-9.-]+)/g;

/** 브라우저에서 도는 파일만. 'use client'가 없으면 서버 컴포넌트다. */
function clientFiles(): string[] {
  const out: string[] = [];
  for (const root of ['app', 'components']) {
    for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!rel.endsWith('.tsx') || rel.includes('.bak')) continue;
      const path = `${root}/${rel}`;
      if (!/^['"]use client['"]/m.test(readFileSync(path, 'utf8'))) continue;
      out.push(path);
    }
  }
  return out;
}

/** 호출이 아닌 등장. 브라우저가 이 주소로 요청하지 않는다. */
const NOT_FETCHED = new Set([
  'www.googleapis.com', // gmail.readonly 스코프 문자열. 실제 호출은 서버가 한다.
]);

function main() {
  const cspHosts = new Set(
    [...readFileSync('next.config.ts', 'utf8').matchAll(URL_RE)].map((m) => m[1]),
  );

  const fetched = new Map<string, string>();
  const linked = new Set<string>();

  for (const path of clientFiles()) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hosts = [...line.matchAll(URL_RE)].map((m) => m[1]);
      if (hosts.length === 0) return;
      // 대소문자 무시 — JSX/객체 속성은 camelCase(loginHref)라 소문자 검사만으로는 놓친다.
      const isLink = /href/i.test(line);
      for (const host of hosts) {
        if (isLink) linked.add(host);
        else if (!fetched.has(host)) fetched.set(host, `${path}:${i + 1}`);
      }
    });
  }

  console.log(`끌어오는 외부 ${fetched.size}종 · 링크로만 ${linked.size}종`);
  for (const [host, where] of fetched) {
    const state = cspHosts.has(host) ? 'ok  ' : NOT_FETCHED.has(host) ? '제외' : 'FAIL';
    console.log(`  ${state} ${host}  ${where}`);
  }
  for (const host of linked) console.log(`  링크 ${host}`);

  const uncovered = [...fetched.keys()].filter((h) => !cspHosts.has(h) && !NOT_FETCHED.has(h));
  check(uncovered.length === 0, `1 정책에 없는 외부 호스트가 없다 (${uncovered.join(', ') || '없음'})`);

  // 반대 방향 — 정책이 실제로 필요한 것을 담고 있는가.
  const required = ['accounts.google.com', 'api.pwnedpasswords.com', 'cdn.jsdelivr.net'];
  required.forEach((need, i) => {
    check(cspHosts.has(need), `${i + 2} 정책에 ${need}가 있다`);
  });

  // 링크가 정책을 넓히지 않았는지 — 링크로만 쓰는 곳이 script-src에 들어가면 과잉이다.
  const csp = readFileSync('next.config.ts', 'utf8');
  const scriptSrc = csp.match(/"script-src[^"]*"/)?.[0] ?? '';
  const overreach = [...linked].filter((h) => !fetched.has(h) && scriptSrc.includes(h));
  check(overreach.length === 0, `5 링크 전용 호스트가 script-src에 없다 (${overreach.join(', ') || '없음'})`);

  console.log(`verify-csp-hosts: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
