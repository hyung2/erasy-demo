'use client';

// 계정 정리 — 정리 큐에 담는 화면.
//
// 이 화면은 시드 더미로 돌고 있었다. 목록은 `deriveCleanupCandidates()`가 고른 **7건 하드코딩**
// 이었고, "요청 접수"는 sessionStorage 플래그만 세웠다. 그래서 A1 개방 스캔이 56개 서비스를
// 찾아와도 정리 화면에는 시드 7건이 떴고, 사용자가 담은 것은 서버에 남지 않았다.
// 회복 투영은 **미완료 정리 요청**을 표적으로 계산하므로(score-service), 큐가 비어 있으면
// 도착점이 낮게 고정된다 — 화면은 접수했다고 말하는데 서버는 아무것도 모르는 상태였다.
//
// 지금은 인벤토리(/api/accounts)와 큐(/api/cleanup/requests)를 서버에서 읽어 그린다.
// 조회에 실패하면 시드 숫자로 되돌아가지 않는다. 못 가져왔으면 못 가져왔다고 말한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServiceAvatar } from '@/components/ServiceAvatar';
import { useDemo } from '@/components/DemoStateClient';
import { primaryLink } from '@/lib/deep-links';
import { destinationFor } from '@/lib/service-links';
import { UNKNOWN_LAST_USED_DAYS } from '@/lib/api-types';
import type {
  AccountDTO,
  CleanupQueueItemDTO,
  CleanupQueueResponse,
} from '@/lib/api-types';

type Tab = 'unlink' | 'delete';

// 정리 화면 대표 딥링크 — 유출 점검이 정리 전 첫 확인 지점(과투자 금지, 단일 노출).
const breachCheck = primaryLink('kidc-breach');

// 큐에 담긴 것으로 볼 상태. 완료(done)는 이미 끝난 일이라 "담김"이 아니다.
const PENDING = new Set(['queued', 'in_progress']);

const riskRank: Record<AccountDTO['risk'], number> = { high: 3, medium: 2, low: 1 };

/** 미사용 기간 표기. 활동일을 모르는 계정(A1 발견분 다수)에 "0개월"이라고 쓰지 않는다. */
function unusedLabel(a: AccountDTO): string {
  if (a.lastUsedDays >= UNKNOWN_LAST_USED_DAYS) return '마지막 사용 시점 미상';
  const months = Math.floor(a.lastUsedDays / 30);
  if (months < 1) return '최근 사용';
  if (months >= 12) {
    const years = Math.floor(months / 12);
    return `${years}년 이상 미사용`;
  }
  return `${months}개월 미사용`;
}

/** 연결 방식 표기 — provider가 곧 정리 행동을 정한다(OAuth 연결 해제 / 자체 가입 탈퇴). */
const providerLabel: Record<AccountDTO['provider'], string> = {
  google: '구글 로그인',
  naver: '네이버 로그인',
  kakao: '카카오 로그인',
  apple: 'Apple 로그인',
  manual: '아이디·비밀번호',
};

export default function CleanupPage() {
  const router = useRouter();
  const { markCleaned } = useDemo();
  const [tab, setTab] = useState<Tab>('unlink');

  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [queue, setQueue] = useState<CleanupQueueItemDTO[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 인벤토리 + 큐를 함께 읽는다. 둘 중 하나만 오면 "담김" 표시가 어긋나므로 같이 세운다.
  const load = useCallback(async () => {
    try {
      const [aRes, qRes] = await Promise.all([
        fetch('/api/accounts', { cache: 'no-store' }),
        fetch('/api/cleanup/requests', { cache: 'no-store' }),
      ]);
      if (!aRes.ok || !qRes.ok) throw new Error(`${aRes.status}/${qRes.status}`);
      const aBody: { data: AccountDTO[] } = await aRes.json();
      const qBody: { data: CleanupQueueItemDTO[] } = await qRes.json();
      setAccounts(aBody.data ?? []);
      setQueue(qBody.data ?? []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // 담긴 계정 = 서버 정본. 로컬 state로만 두면 탭을 닫는 순간 사라져 담은 사실과 화면이 어긋난다.
  const queuedIds = useMemo(
    () => new Set(queue.filter((q) => PENDING.has(q.status)).map((q) => q.accountId)),
    [queue],
  );

  // 이미 정리를 마친 계정. 담김(PENDING)에서 빠졌다고 선택 가능 목록으로 되돌리면
  // 방금 끝낸 일을 다시 하라고 권하는 화면이 된다.
  const doneIds = useMemo(
    () => new Set(queue.filter((q) => q.status === 'done').map((q) => q.accountId)),
    [queue],
  );

  // 탭 = 정리 행동. OAuth 연결 계정은 연결 해제, 자체 가입 계정은 삭제 요청이다.
  //   서버의 actionType 파생(provider === 'manual' ? delete : revoke)과 같은 기준이라
  //   화면에서 고른 탭과 서버가 담는 행동이 어긋나지 않는다.
  const rows = useMemo(() => {
    const wantManual = tab === 'delete';
    return accounts
      .filter((a) => (a.provider === 'manual') === wantManual)
      .sort((x, y) => {
        const d = riskRank[y.risk] - riskRank[x.risk];
        return d !== 0 ? d : y.lastUsedDays - x.lastUsedDays;
      });
  }, [accounts, tab]);

  const selectable = rows.filter((a) => !queuedIds.has(a.id) && !doneIds.has(a.id));
  const selCount = selectable.filter((a) => checked[a.id]).length;
  const allSelected = selectable.length > 0 && selCount === selectable.length;
  const queuedInTab = rows.filter((a) => queuedIds.has(a.id)).length;

  function toggle(id: string) {
    setChecked((p) => ({ ...p, [id]: !p[id] }));
  }
  function selectAll() {
    const next: Record<string, boolean> = { ...checked };
    selectable.forEach((a) => (next[a.id] = !allSelected));
    setChecked(next);
  }

  // 큐에 담기 — 서버가 소유권·멱등·actionType을 판정한다.
  async function submitRequest() {
    const ids = selectable.filter((a) => checked[a.id]).map((a) => a.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/cleanup/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: ids }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setToast(body?.error ?? '정리 목록에 담지 못했습니다.');
        return;
      }
      const body: { data: CleanupQueueResponse } = await res.json();
      setQueue(body.data.items);
      setChecked({});
      setConfirmOpen(false);

      // 담기지 못한 건이 있으면 조용히 넘기지 않는다. 실계정이 없어 시드 목록을 보고 있는
      // 상태(폴백)에서 담기를 누르면 전부 여기로 잡힌다 — 그때 "접수됐다"고 말하면 거짓이 된다.
      if (body.data.notFound > 0 && body.data.queued === 0) {
        setToast(
          `담지 못했습니다. 지금 보이는 목록은 예시 데이터라 정리 요청을 접수할 수 없습니다(${body.data.notFound}건).`,
        );
        return;
      }
      markCleaned();
      router.push('/cleanup/result');
    } catch {
      setToast('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  // 큐에서 빼기 — 담기가 되돌릴 수 없으면 조작 실수를 복구할 방법이 없다.
  async function removeFromQueue(id: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/cleanup/requests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: [id] }),
      });
      if (!res.ok) {
        setToast('목록에서 빼지 못했습니다.');
        return;
      }
      setQueue((prev) => prev.filter((q) => !(q.accountId === id && PENDING.has(q.status))));
      setToast('정리 목록에서 뺐습니다.');
    } catch {
      setToast('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 다녀와서 "정리했어요"를 누르면 요청이 완료로 닫힌다.
   *
   * 구현스코프 4장의 수용 기준이 이 순서다 — 액션 클릭 → 실 페이지 이동 → 복귀 후 처리됨
   * 마킹 → 점수 재계산. 그동안 마킹 자리가 비어 있어서 회복 규칙이 발화하지 못했다.
   *
   * actionType은 화면이 아니라 provider가 정한다. 서버의 파생 규칙(manual이면 delete,
   * 아니면 revoke)과 같은 기준이라 담긴 요청과 닫는 요청이 어긋나지 않는다.
   */
  async function markDone(a: AccountDTO) {
    setBusy(true);
    try {
      const res = await fetch('/api/cleanup/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: a.id,
          actionType: a.provider === 'manual' ? 'delete' : 'revoke',
          status: 'done',
        }),
      });
      if (!res.ok) {
        setToast('정리 완료로 기록하지 못했습니다.');
        return;
      }
      setQueue((prev) =>
        prev.map((q) => (q.accountId === a.id ? { ...q, status: 'done' as const } : q)),
      );
      setToast(`“${a.name}” 정리 완료 · 안전도에 반영됩니다.`);
    } catch {
      setToast('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const actionWord = tab === 'delete' ? '삭제 요청' : '연결 해제';

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>계정 정리</h1>
          {loadState === 'ready' && (
            <span className="badge warn-badge">{queuedIds.size}건 담김</span>
          )}
        </div>
      </div>
      <p className="page-sub">안 쓰는 소셜 연결을 끊고, 삭제가 필요한 계정은 요청하세요.</p>

      {/* 탭 */}
      <div className="chip-row" role="group" aria-label="정리 방식">
        <button
          type="button"
          className={`chip${tab === 'unlink' ? ' active' : ''}`}
          onClick={() => setTab('unlink')}
        >
          소셜 연결 끊기
        </button>
        <button
          type="button"
          className={`chip${tab === 'delete' ? ' active' : ''}`}
          onClick={() => setTab('delete')}
        >
          계정 삭제 요청
        </button>
      </div>

      {loadState === 'loading' && (
        <section className="panel" aria-busy="true">
          <p className="panel-note">정리 대상을 불러오는 중입니다…</p>
        </section>
      )}

      {loadState === 'error' && (
        <section className="panel">
          <p className="status danger" role="alert">
            정리 대상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          <button type="button" className="btn btn-secondary compact" onClick={() => void load()}>
            다시 불러오기
          </button>
        </section>
      )}

      {loadState === 'ready' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>{tab === 'delete' ? '삭제 요청할 계정' : '안 쓰는 연결 일괄 정리'}</h3>
                <p className="panel-note">
                  {rows.length}개 · 담긴 것 {queuedInTab}개
                </p>
              </div>
              {selectable.length > 0 && (
                <button type="button" className="btn btn-secondary compact" onClick={selectAll}>
                  {allSelected ? '선택 해제' : `${selectable.length}개 일괄 선택`}
                </button>
              )}
            </div>

            <p className="action-desc">
              {tab === 'delete'
                ? '선택한 계정을 정리 목록에 담습니다. 담은 뒤 각 서비스로 이동해 직접 탈퇴하시고, 돌아와 완료를 표시하면 안전도에 반영됩니다.'
                : '선택한 연결을 정리 목록에 담습니다. 담은 뒤 제공사 연결 관리 페이지에서 직접 끊으시고, 돌아와 완료를 표시하면 안전도에 반영됩니다.'}
            </p>

            {rows.length === 0 ? (
              <p className="panel-note">
                {tab === 'delete'
                  ? '아이디·비밀번호로 가입한 계정이 아직 없습니다.'
                  : '소셜 로그인으로 연결된 계정이 아직 없습니다.'}
              </p>
            ) : (
              <>
                <p className="list-label">{actionWord} 대상</p>
                <div>
                  {rows.map((a) => {
                    const isDone = doneIds.has(a.id);
                    const isQueued = queuedIds.has(a.id);
                    const dest = isQueued ? destinationFor(a) : null;
                    if (isDone) {
                      return (
                        <div className="cleanup-item is-done" key={a.id}>
                          <ServiceAvatar service={a.name} />
                          <span className="cleanup-info">
                            <strong>{a.name}</strong>
                            <span>정리를 마쳤습니다</span>
                          </span>
                          <span className="resolved-tag">✓ 정리 완료</span>
                        </div>
                      );
                    }
                    return isQueued ? (
                      <div className="cleanup-item is-requested" key={a.id}>
                        <div className="cleanup-item-main">
                          <ServiceAvatar service={a.name} />
                          <span className="cleanup-info">
                            <strong>{a.name}</strong>
                            <span>{unusedLabel(a)}</span>
                          </span>
                          <span className="req-tag">담김</span>
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={busy}
                            onClick={() => void removeFromQueue(a.id)}
                          >
                            빼기
                          </button>
                        </div>

                        {/* 정리하러 보내고, 다녀오면 닫는다. 우리가 대신 처리하지 않는다. */}
                        <div className="cleanup-go">
                          {dest ? (
                            <>
                              <p className="cleanup-go-note">{dest.note}</p>
                              <div className="cleanup-go-actions">
                                <a
                                  className="btn-sm primary"
                                  href={dest.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {dest.label} ↗
                                </a>
                                <button
                                  type="button"
                                  className="btn-sm"
                                  disabled={busy}
                                  onClick={() => void markDone(a)}
                                >
                                  정리했어요
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="cleanup-go-note">
                                이 서비스의 정리 경로는 아직 확인되지 않았습니다. 없는 페이지로
                                보내지 않으려고 링크를 만들지 않았습니다.
                              </p>
                              <div className="cleanup-go-actions">
                                <button
                                  type="button"
                                  className="btn-sm"
                                  disabled={busy}
                                  onClick={() => void markDone(a)}
                                >
                                  직접 정리했어요
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <label className="cleanup-item" key={a.id}>
                        <input
                          type="checkbox"
                          checked={!!checked[a.id]}
                          onChange={() => toggle(a.id)}
                        />
                        <ServiceAvatar service={a.name} />
                        <span className="cleanup-info">
                          <strong>{a.name}</strong>
                          <span>{unusedLabel(a)}</span>
                        </span>
                        <span className="cleanup-method">{providerLabel[a.provider]}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {breachCheck && (
              <div className="cleanup-discovery">
                <span>정리 전, 유출된 계정이 있는지도 확인해 보세요.</span>
                <a
                  className="btn-sm"
                  href={breachCheck.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={breachCheck.description}
                >
                  {breachCheck.label} ↗<span className="sr-only">(새 탭에서 열림)</span>
                </a>
              </div>
            )}
          </section>

          {/* 하단 액션 바 */}
          <div className="action-bar">
            <span className="count">
              <strong>{selCount}</strong>개 {actionWord}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selCount === 0 || busy}
              onClick={() => setConfirmOpen(true)}
            >
              요청 접수
            </button>
          </div>
        </>
      )}

      {/* 확인 모달 — 비가역 게이트(요청만 접수, 실제 해제 없음) */}
      {confirmOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setConfirmOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-confirm-title">
            <h3 id="modal-confirm-title">
              {selCount}개 계정 {actionWord}를 접수하시겠어요?
            </h3>
            <p>
              이레이지가 대신 해제하거나 탈퇴하지 않습니다. 목록에 담으면 각 항목에 정리하러 갈
              경로가 붙고, 다녀와서 완료를 표시하면 점수에 반영됩니다. 목록에서 다시 뺄 수 있습니다.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submitRequest()}
              >
                {busy ? '접수 중…' : '요청 접수'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
