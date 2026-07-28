// 자체 가입(이메일+비밀번호) 로그인용 비밀번호 해시 유틸.
//
// 설계 근거
// - 외부 의존성 0: Node 표준 `crypto.scrypt`(RFC 7914). 공개 레포에 해시 패키지를 새로 들이지 않는다.
// - 저장 형식: `scrypt$N$r$p$<salt-b64>$<hash-b64>` — 파라미터를 값에 동봉한다.
//   검증은 **저장된 파라미터를 그대로 읽어 재계산**하므로, 나중에 N을 올려도 옛 해시가 계속 검증된다.
// - 비교는 timingSafeEqual. 길이가 다르면 즉시 false(해시 길이는 비밀이 아니다).
//
// 원문 비밀번호는 어디에도 저장·로깅하지 않는다. 이 파일 밖으로 나가는 값은 해시 문자열뿐이다.
// ※ 스키마의 "자격증명 미저장" 원칙은 **사용자가 관리하는 외부 서비스의 비밀번호**를 뜻한다.
//   본 서비스 자체 로그인 비밀번호는 그 원칙의 대상이 아니며, 원문이 아닌 해시로만 보관한다.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP 권고(N=2^15, r=8, p=1). 메모리 요구량 = 128·N·r ≈ 33.5MB로 scrypt 기본 maxmem(32MB)을 넘으므로
// maxmem을 명시해야 한다. 빠뜨리면 해시·검증 양쪽이 런타임 에러로 죽는다.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

function maxmemFor(n: number, r: number): number {
  return 256 * n * r + 1024 * 1024; // Node 문서 권장식(128·N·r의 2배 여유) + 여유분
}

function derive(
  password: string,
  salt: Buffer,
  keylen: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: maxmemFor(n, r) }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** 비밀번호 정책 — 위반 사유를 사람 문장으로 돌려준다(통과 시 null). */
export function validatePassword(password: string): string | null {
  if (password.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (password.length > 200) return '비밀번호가 너무 깁니다.';
  // 길이를 1차 방어선으로 두고 문자 구성은 강제하지 않는다(NIST SP 800-63B 권고).
  return null;
}

/** 이메일 형식 검사 + 정규화(소문자·trim). 형식 위반이면 null. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // 저장값이 손상됐거나 비정상적으로 큰 파라미터면 계산을 시도하지 않는다(메모리 폭발 차단).
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 1024 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const key = await derive(password, salt, expected.length, n, r, p);
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}
