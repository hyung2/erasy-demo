'use client';

// 메일함 기반 계정 발견(T5.6) — 버튼 → 구글 동의 → 1회성 토큰 → 서버 스캔 → 결과.
//
// 정직성 규약(이 컴포넌트가 지켜야 하는 것)
//  - 결과는 "메일 기준 추정"이다. 실제 로그인일이 아님을 결과 옆에 항상 표기한다.
//  - 카탈로그 밖 서비스는 발견되지 않는다. "못 찾은 것"과 "없는 것"을 구분해 보여준다.
//  - 토큰은 이 컴포넌트의 지역 변수로만 존재하다 요청 후 사라진다. state에도 담지 않는다.
import { useState } from 'react';
import type { ScanHit } from '@/lib/gmail-scan';

type ScanData = {
  hits: ScanHit[];
  unmatchedDomains: number;
  scanned: number;
  catalogSize: number;
  failedQueries: number;
  /** 인벤토리에 새로 추가된 계정 수. */
  discoveredCount: number;
  /** 활동일이 갱신된 기존 계정 수. */
  updatedCount: number;
};

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Google Identity Services 최소 타입 — 라이브러리 의존 없이 필요한 표면만 선언한다.
type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken: () => void };
type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (res: TokenResponse) => void;
        error_callback?: (err: { type?: string }) => void;
      }) => TokenClient;
    };
  };
};

function loadGis(): Promise<GoogleGlobal> {
  const existing = (window as unknown as { google?: GoogleGlobal }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = prior ?? document.createElement('script');
    const onLoad = () => {
      const g = (window as unknown as { google?: GoogleGlobal }).google;
      if (g?.accounts?.oauth2) resolve(g);
      else reject(new Error('GIS 로드 실패'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', () => reject(new Error('GIS 로드 실패')), { once: true });
    if (!prior) {
      script.src = GIS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export default function GmailScan({ onApplied }: { onApplied?: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScanData | null>(null);

  async function runScan() {
    setError(null);
    setPending(true);

    try {
      const idRes = await fetch('/api/scan/gmail/client-id');
      const idJson = (await idRes.json()) as { ok: boolean; data?: { clientId: string }; error?: string };
      if (!idJson.ok || !idJson.data) {
        setError(idJson.error ?? '메일 스캔을 시작할 수 없습니다.');
        setPending(false);
        return;
      }

      const gis = await loadGis();
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: idJson.data.clientId,
        scope: GMAIL_SCOPE,
        callback: (res) => {
          // 토큰은 여기 지역 변수로만 산다 — state·스토리지에 넣지 않는다.
          if (!res.access_token) {
            setError('메일 접근 권한이 필요합니다.');
            setPending(false);
            return;
          }
          void postScan(res.access_token);
        },
        error_callback: () => {
          setError('권한 창이 닫혔습니다. 다시 시도해 주세요.');
          setPending(false);
        },
      });
      client.requestAccessToken();
    } catch {
      setError('메일 스캔을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      setPending(false);
    }
  }

  async function postScan(accessToken: string) {
    try {
      const res = await fetch('/api/scan/gmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const json = (await res.json()) as { ok: boolean; data?: ScanData; error?: string };
      if (!json.ok || !json.data) {
        setError(json.error ?? '메일함 조회에 실패했습니다.');
        return;
      }
      setData(json.data);
      onApplied?.();
    } catch {
      setError('메일함 조회에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="gmail-scan-title">
      <div className="breach-head">
        <h3 id="gmail-scan-title">메일함으로 계정 찾기</h3>
        <span className="badge live">실측</span>
      </div>

      <p className="score-sub">
        받은 메일의 발신자만 확인해 가입한 서비스를 찾습니다. 메일 본문은 읽지 않고, 발신자와 날짜만
        사용합니다. 권한은 이 조회에만 쓰이고 저장하지 않습니다.
      </p>

      <button type="button" className="btn btn-primary" onClick={runScan} disabled={pending}>
        {pending ? '메일함 확인 중…' : 'Gmail로 계정 찾기'}
      </button>

      {error && (
        <p className="status danger" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {data && (
        <div style={{ marginTop: 16 }}>
          <p className="status safe" role="status">
            {data.hits.length}개 서비스를 찾았습니다 — 몰랐던 계정 {data.discoveredCount}개 추가 ·
            활동일 {data.updatedCount}개 갱신
          </p>

          <ul className="scan-hits">
            {data.hits.map((hit) => (
              <li key={hit.service} className="report-row">
                <span>{hit.service}</span>
                <span className="advice">
                  {formatLastSeen(hit.lastSeenDays)} · 메일 기준 추정
                </span>
              </li>
            ))}
          </ul>

          <p className="advice" style={{ marginTop: 12 }}>
            마지막 활동일은 <strong>메일 수신일 기준 추정치</strong>입니다. 실제 로그인 기록이 아니라
            광고 메일만 받아도 최근으로 잡힙니다.
          </p>
          <p className="advice">
            주요 서비스 {data.catalogSize}곳을 대조했습니다. 목록에 없는 서비스는 이 방법으로 찾지
            못합니다 — 못 찾은 것이지 없는 것이 아닙니다
            {data.unmatchedDomains > 0 && `(미확인 발신 도메인 ${data.unmatchedDomains}곳)`}.
            {data.failedQueries > 0 && ` 조회 실패 ${data.failedQueries}건은 결과에서 빠졌습니다.`}
          </p>
        </div>
      )}
    </section>
  );
}

function formatLastSeen(days: number): string {
  if (days <= 1) return '어제 이후 활동';
  if (days < 30) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}
