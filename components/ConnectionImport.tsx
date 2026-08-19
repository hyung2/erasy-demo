'use client';

// 소셜 연결서비스 목록 가져오기 — 붙여넣기 → 한 번에 가져오기.
//
// 기획 원칙: 사용자에게 확인 노동을 넘기지 않는다.
// 목록에는 직접 만든 프로젝트나 테스트 앱이 섞이는데, 이걸 사용자가 하나씩 체크해 빼게 하면
// "한 번에 확인"이라는 제품 약속과 정반대가 된다. 그래서 기본은 **전부 가져오기**이고,
// 의심스러운 항목은 가져온 뒤에 우리가 짚어 준다. 계정 정리는 원래 인벤토리 화면이 하는 일이다.
//
// 그렇다고 자동으로 지우지도 않는다(2026-07-28 메일 스캔 교훈 — 필터를 세게 걸면 참값이 사라진다).
// 넣되 표시하고, 빼는 판단은 사용자가 편한 자리에서 하게 한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseConnectionList, type ImportProvider, type ParsedConnection } from '@/lib/connection-import';

const PROVIDERS: Array<{ id: ImportProvider; label: string; href: string; hint: string }> = [
  {
    id: 'google',
    label: '구글',
    href: 'https://myaccount.google.com/connections',
    hint: '보안 > 타사 앱 및 서비스 > 모든 연결 보기',
  },
  {
    id: 'kakao',
    label: '카카오',
    href: 'https://accounts.kakao.com/weblogin/account/partner',
    hint: '카카오계정 > 연결된 서비스 관리',
  },
  {
    id: 'naver',
    label: '네이버',
    href: 'https://nid.naver.com/user2/help/myInfo',
    hint: '네이버 내정보 > 외부 사이트 연결',
  },
];

/** 이번 목록에서 사라진 계정 — 제공사 화면에서 끊고 온 것으로 보이는 후보. */
type MissingConnection = { accountId: string; name: string };

type ImportResult = {
  provider: ImportProvider;
  submitted: number;
  createdCount: number;
  upgradedCount: number;
  unchangedCount: number;
  missing: MissingConnection[];
};

export default function ConnectionImport({ onApplied }: { onApplied?: () => void }) {
  const [provider, setProvider] = useState<ImportProvider>('google');
  const [text, setText] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [flagged, setFlagged] = useState<ParsedConnection[]>([]);
  /** 사라짐 후보 중 사용자가 "정말 끊었다"고 남겨 둔 것. 기본은 전부 켜 둔다. */
  const [missingKept, setMissingKept] = useState<Set<string>>(new Set());
  const [markPending, setMarkPending] = useState(false);
  /** 정리 완료로 기록한 건수. null = 아직 확인 안 함. */
  const [markedCount, setMarkedCount] = useState<number | null>(null);
  /** 연결 목록 창을 열어 둔 상태 — 돌아왔을 때 바로 담을 수 있게 안내를 띄운다. */
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const openedAt = useRef(0);

  const parsed = useMemo(() => (text.trim() ? parseConnectionList(text) : null), [text]);

  const isChecked = (item: ParsedConnection) => item.preselected && !excluded.has(item.name);
  const selected = parsed?.items.filter(isChecked) ?? [];
  const warned = parsed?.items.filter((i) => i.warning) ?? [];

  function toggle(item: ParsedConnection) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (isChecked(item)) next.add(item.name);
      else next.delete(item.name);
      return next;
    });
  }

  /**
   * 클립보드에서 바로 읽어 온다.
   * 브라우저는 사용자 제스처 없는 clipboard.readText()를 막기 때문에 완전 무클릭은 불가능하다.
   * 그래서 "돌아오면 버튼 하나"가 물리적 최소이고, 그 버튼을 눈에 띄는 자리에 둔다.
   */
  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) {
        setText(clip);
        setAwaitingReturn(false);
        setError(null);
      } else {
        setError('복사한 내용이 없습니다. 연결 목록을 전체 선택해 복사한 뒤 다시 눌러 주세요.');
      }
    } catch {
      setError('브라우저가 붙여넣기를 막았습니다. 아래 칸에 직접 붙여넣어 주세요.');
    }
  }, []);

  /** 연결 목록 창을 새로 띄우고, 돌아오는 시점을 잡아 안내를 올린다. */
  function openProviderPage() {
    openedAt.current = Date.now();
    setAwaitingReturn(true);
    setResult(null);
    window.open(current.href, '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    if (!awaitingReturn) return;
    // 다른 창에 다녀온 뒤 우리 탭이 다시 보이면 담기 안내를 강조한다.
    // 클립보드를 몰래 읽지는 않는다 — 읽기는 사용자가 버튼을 누를 때만 일어난다.
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - openedAt.current < 1500) return; // 창이 뜨자마자 돌아온 경우는 무시
      setAwaitingReturn(true);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [awaitingReturn]);

  async function submit() {
    if (selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          names: selected.map((s) => s.name),
          // 사라짐 판정은 **붙여넣은 원본 전체**로 재야 한다. 담을 목록(selected)으로 재면
          // 사용자가 "이건 빼자"고 체크만 해제한 서비스가 끊긴 것으로 둔갑한다.
          allNames: parsed?.items.map((i) => i.name) ?? [],
        }),
      });
      const json = (await res.json()) as { ok: boolean; data?: ImportResult; error?: string };
      if (!json.ok || !json.data) {
        setError(json.error ?? '가져오기에 실패했습니다.');
        return;
      }
      // 가져온 뒤에 짚어 주기 위해 표시 대상만 남긴다.
      setFlagged(warned.filter((w) => selected.some((s) => s.name === w.name)));
      // missing이 없는 응답(구버전 배포와 섞이는 순간)에도 화면이 죽지 않게 둔다.
      setResult({ ...json.data, missing: json.data.missing ?? [] });
      setMissingKept(new Set((json.data.missing ?? []).map((m) => m.accountId)));
      setMarkedCount(null);
      setText('');
      setExcluded(new Set());
      setShowDetails(false);
      onApplied?.();
    } catch {
      setError('가져오기에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  /**
   * 사라진 계정을 정리 완료로 기록한다.
   *
   * 자동으로 하지 않는 이유: 목록을 일부만 복사해 왔을 수 있다. 그 경우 끊지 않은 계정이
   * 완료로 넘어가 점수가 부풀고, 그건 이 제품이 가장 하면 안 되는 거짓말이다.
   * 그래서 판정은 서버가 하고, 확정은 사용자가 여기서 한 번 끄덕여야 일어난다.
   *
   * actionType이 revoke인 이유: 소셜 연결 목록에서 사라졌다는 건 연결 해제이지 탈퇴가 아니다.
   * 서비스 계정 자체는 그대로 남아 있을 수 있다.
   */
  async function confirmMissing() {
    const targets = (result?.missing ?? []).filter((m) => missingKept.has(m.accountId));
    if (targets.length === 0) return;
    setMarkPending(true);
    setError(null);
    try {
      const results = await Promise.all(
        targets.map((m) =>
          fetch('/api/cleanup/mark', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              accountId: m.accountId,
              actionType: 'revoke',
              status: 'done',
            }),
          }).then((r) => r.ok),
        ),
      );
      const ok = results.filter(Boolean).length;
      setMarkedCount(ok);
      // 일부만 성공하면 숨기지 않는다 — 사용자는 몇 개가 반영됐는지 알아야 한다.
      if (ok < targets.length) {
        setError(`${targets.length}개 중 ${ok}개만 기록됐습니다. 잠시 후 다시 시도해 주세요.`);
      }
      onApplied?.();
    } catch {
      setError('정리 완료 기록에 실패했습니다.');
    } finally {
      setMarkPending(false);
    }
  }

  function toggleMissing(accountId: string) {
    setMissingKept((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  const current = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <section className="panel" aria-labelledby="conn-import-title">
      <div className="breach-head">
        <h3 id="conn-import-title">간편가입한 서비스 가져오기</h3>
        <span className="badge live">실측</span>
      </div>

      <p className="score-sub">
        구글·카카오·네이버로 간편가입한 서비스 목록입니다. 연결 목록을 복사해 붙여넣으면 한 번에
        인벤토리에 담습니다. 어느 계정에서 가져왔는지 알기 때문에{' '}
        <strong>가입 방식이 추측이 아닌 사실로 기록</strong>됩니다.
      </p>

      <div className="chip-row" role="tablist" aria-label="가져올 계정 선택">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={provider === p.id}
            className={`chip ${provider === p.id ? 'active' : ''}`}
            onClick={() => setProvider(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!parsed && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="btn btn-primary" onClick={openProviderPage}>
            {current.label} 연결 목록 열기
          </button>
          <button
            type="button"
            className={awaitingReturn ? 'btn btn-primary' : 'btn'}
            onClick={pasteFromClipboard}
          >
            {awaitingReturn ? '복사한 목록 담기' : '복사한 목록 붙여넣기'}
          </button>
        </div>
      )}

      <p className="advice">
        {awaitingReturn
          ? '연결 목록에서 전체 선택(Ctrl+A) 후 복사(Ctrl+C)하고 돌아와 "복사한 목록 담기"를 누르세요.'
          : `${current.hint}에서 목록을 복사해 오면 됩니다.`}
      </p>

      <details style={{ marginBottom: 8 }}>
        <summary className="advice" style={{ cursor: 'pointer' }}>
          직접 붙여넣기
        </summary>
        <label className="sr-only" htmlFor="conn-paste">
          연결 서비스 목록 붙여넣기
        </label>
        <textarea
          id="conn-paste"
          className="text-input"
          rows={4}
          placeholder="복사한 목록을 여기에 붙여넣어도 됩니다."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </details>

      {parsed && parsed.items.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="status safe" role="status">
            {parsed.items.length}개 서비스를 찾았습니다
            {parsed.mergedDuplicates > 0 && ` · 중복 ${parsed.mergedDuplicates}건은 하나로 합쳤습니다`}
          </p>

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={pending || selected.length === 0}
            style={{ marginTop: 8 }}
          >
            {pending ? '가져오는 중…' : `${selected.length}개 모두 가져오기`}
          </button>

          <p className="advice" style={{ marginTop: 8 }}>
            {warned.length > 0
              ? `직접 만든 프로젝트로 보이는 ${warned.length}개가 섞여 있습니다. 일단 담고, 가져온 뒤에 알려드립니다.`
              : '가져온 뒤 계정 목록에서 언제든 지울 수 있습니다.'}{' '}
            <button
              type="button"
              className="linklike"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
            >
              {showDetails ? '목록 접기' : '목록 보고 고르기'}
            </button>
          </p>

          {showDetails && (
            <ul className="scan-hits">
              {parsed.items.map((item) => (
                <li key={item.name} className="report-row">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={isChecked(item)} onChange={() => toggle(item)} />
                    <span>{item.name}</span>
                  </label>
                  <span className="advice">
                    {item.warning ?? (item.category === 'unknown' ? '분류 미확인' : item.category)}
                    {item.occurrences > 1 && ` · ${item.occurrences}회 연결`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="status danger" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <p className="status safe" role="status">
            몰랐던 계정 {result.createdCount}개를 담았습니다
            {result.upgradedCount > 0 && ` · 가입 방식 확정 ${result.upgradedCount}개`}
            {result.unchangedCount > 0 && ` · 이미 있던 계정 ${result.unchangedCount}개`}
          </p>

          {flagged.length > 0 && (
            <p className="advice">
              이 중 {flagged.length}개({flagged.map((f) => f.name).join(', ')})는 직접 만든
              프로젝트로 보입니다. 계정 목록에서 지우시면 점수에서도 빠집니다.
            </p>
          )}

          <p className="advice">
            연결 목록에는 마지막 사용일이 없어 활동일은 <strong>미상</strong>으로 담았습니다. 언제
            마지막으로 썼는지는 지어내지 않습니다.
          </p>

          {/* 사라진 항목 확인 — 정리 완료 기록의 유일한 관문. */}
          {result.missing.length > 0 && markedCount === null && (
            <div className="revoke-confirm">
              <p className="status safe" role="status">
                {result.missing.length}개가 {current.label} 연결 목록에서 사라졌습니다
              </p>
              <p className="advice">
                {current.label}에서 연결을 끊으셨다면 정리 완료로 기록하고 안전도 점수에
                반영합니다. <strong>목록을 일부만 복사하셨다면</strong> 끊지 않은 항목을 아래에서
                빼 주세요.
              </p>

              <ul className="scan-hits">
                {result.missing.map((m) => (
                  <li key={m.accountId} className="report-row">
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={missingKept.has(m.accountId)}
                        onChange={() => toggleMissing(m.accountId)}
                      />
                      <span>{m.name}</span>
                    </label>
                    <span className="advice">연결 해제</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmMissing}
                disabled={markPending || missingKept.size === 0}
                style={{ marginTop: 8 }}
              >
                {markPending ? '기록하는 중…' : `${missingKept.size}개 정리 완료로 표시`}
              </button>
            </div>
          )}

          {markedCount !== null && markedCount > 0 && (
            <p className="status safe" role="status" style={{ marginTop: 16 }}>
              {markedCount}개를 정리 완료로 기록했습니다. 안전도 점수에서 이 계정들이 빠집니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
