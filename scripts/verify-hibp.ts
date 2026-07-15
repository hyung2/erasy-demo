// HIBP range 실호출 검증(T5.1) — lib/hibp의 실제 코드 경로로 유출/비유출 판정 확인.
// 실행: npx tsx scripts/verify-hibp.ts (네트워크 필요, API 키 불요)
// crypto.subtle은 Node 20+ globalThis에 존재 → 브라우저와 동일 함수 검증.
import { checkPasswordPwned } from '../lib/hibp';

async function main() {
  // 널리 알려진 유출 비번 → count > 0 기대
  const known = 'password123';
  const kr = await checkPasswordPwned(known);
  console.log(`[known] "${known}" → pwned=${kr.pwned} count=${kr.count.toLocaleString('en-US')}`);

  // 무작위 강한 비번 → 유출 이력 없음 기대
  const strong = `Zx9$q${Math.random().toString(36).slice(2)}${Date.now()}!Kp7`;
  const sr = await checkPasswordPwned(strong);
  console.log(`[strong] (랜덤) → pwned=${sr.pwned} count=${sr.count}`);

  const ok = kr.pwned && kr.count > 0 && !sr.pwned && sr.count === 0;
  console.log(`[verdict] 유출비번 감지=${kr.pwned && kr.count > 0} · 강한비번 clean=${!sr.pwned} → ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
