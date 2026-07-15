// HIBP Pwned Passwords — k-익명성 range 조회(무료·API 키 불요).
// 프라이버시 핵심: 비밀번호는 브라우저에서 SHA-1 해싱하고, 해시 앞 5자(prefix)만 전송한다.
//   전체 해시·원문은 어디로도(이레이지 서버 포함) 나가지 않는다. HIBP range 엔드포인트는
//   CORS를 허용하므로 브라우저가 직접 호출한다(서버 프록시 경유 금지 — 그래야 원문 무접촉 보장).
// 응답: prefix 버킷의 "{suffix}:{count}" 목록. 내 해시 suffix가 매칭되면 count = 유출 횟수.
// crypto.subtle은 브라우저·Node 20+ 공통(globalThis.crypto) → UI·검증 스크립트가 동일 경로.

const HIBP_RANGE = 'https://api.pwnedpasswords.com/range/';

async function sha1Upper(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export type PwnedResult = {
  pwned: boolean;
  count: number; // 유출 횟수(0 = 이력 없음)
};

// 비밀번호 유출 여부 실시간 대조. 실패 시 throw(호출부에서 사용자 카피로 처리).
export async function checkPasswordPwned(password: string): Promise<PwnedResult> {
  const hash = await sha1Upper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const res = await fetch(`${HIBP_RANGE}${prefix}`, {
    // 응답 크기를 균일화해 prefix 관측만으로 추론하기 어렵게(HIBP 권장 패딩).
    headers: { 'Add-Padding': 'true' },
  });
  if (!res.ok) throw new Error(`HIBP range 응답 오류: ${res.status}`);

  const body = await res.text();
  for (const line of body.split('\n')) {
    const [sfx, countStr] = line.trim().split(':');
    if (sfx === suffix) {
      const count = Number.parseInt(countStr, 10);
      return { pwned: count > 0, count: Number.isFinite(count) ? count : 0 };
    }
  }
  return { pwned: false, count: 0 };
}
