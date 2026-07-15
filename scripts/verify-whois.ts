// 런타임 실측(T5.2) — KISA WHOIS 실 API 1건 호출 검증.
// 실행: npx tsx --env-file=.env scripts/verify-whois.ts [도메인]
// 검증: (a) 키 존재(boolean) (b) 실 API 응답 resultCode·요약 필드 (c) breach 연계 경로.
// 시크릿 미출력: serviceKey 값은 어디에도 찍지 않음(존재 여부·응답 요약만).
import { lookupWhois, whoisForBreachService, domainForBreachService } from '../lib/kisa-whois';

async function main() {
  const keySet = Boolean(process.env.KISA_WHOIS_SERVICE_KEY);
  console.log(`[env] KISA_WHOIS_SERVICE_KEY: ${keySet ? 'SET' : 'UNSET'}`);
  if (!keySet) {
    console.error('키 미설정 — 여기서 중단. .env의 KISA_WHOIS_SERVICE_KEY 확인 필요.');
    process.exit(1);
  }

  // KISA WHOIS domain_name은 .kr/한글 도메인 전용 — 기본 조회는 .kr 도메인.
  const domain = process.argv[2] ?? 'nic.or.kr';
  console.log(`\n[1] 직접 도메인 조회: ${domain}`);
  const r = await lookupWhois(domain, 'domain');
  console.log(
    `  ok=${r.ok} resultCode=${r.resultCode ?? 'null'} resultMsg=${r.resultMsg ?? 'null'} rawLen=${r.rawLength}`,
  );
  console.log(
    `  registrant=${r.registrant ?? '-'} · registrar=${r.registrar ?? '-'} · country=${r.country ?? '-'}`,
  );

  console.log(`\n[2] breach 연계 경로: 유출 서비스 '뽐뿌' → ${domainForBreachService('뽐뿌')}`);
  const b = await whoisForBreachService('뽐뿌');
  if (b) {
    console.log(
      `  ok=${b.ok} resultCode=${b.resultCode ?? 'null'} · registrar=${b.registrar ?? '-'} · country=${b.country ?? '-'} rawLen=${b.rawLength}`,
    );
  } else {
    console.log('  매핑 없음(null)');
  }

  const anyOk = r.ok || (b?.ok ?? false);
  const gotResponse = r.resultCode !== null || (b?.resultCode ?? null) !== null;
  console.log(
    `\n[결과] 실 API 응답 수신=${gotResponse} · 정상조회(resultCode 0)=${anyOk}`,
  );
  if (!gotResponse) {
    console.error('응답 파싱 실패 — resultCode 미검출. 엔드포인트/키 형태 점검 필요.');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[verify-whois] 실패:', (e as Error).message);
  process.exit(1);
});
