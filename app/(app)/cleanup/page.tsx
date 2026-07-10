'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServiceAvatar } from '@/components/ServiceAvatar';
import { useDemo } from '@/components/DemoStateClient';
import {
  deriveCleanupCandidates,
  linkMethodLabel,
  deleteRequests,
  requestTone,
} from '@/lib/dummy-data';

type Tab = 'unlink' | 'delete';

const reqDot = { success: 'is-safe', warning: 'is-warn', neutral: '' } as const;

export default function CleanupPage() {
  const router = useRouter();
  const { markCleaned } = useDemo();
  const [tab, setTab] = useState<Tab>('unlink');

  const candidates = useMemo(() => deriveCleanupCandidates(), []);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selCount = candidates.filter((c) => checked[c.id]).length;
  const allSelected = selCount === candidates.length;

  function toggle(id: string) {
    setChecked((p) => ({ ...p, [id]: !p[id] }));
  }
  function selectAll() {
    const next: Record<string, boolean> = {};
    candidates.forEach((c) => (next[c.id] = !allSelected));
    setChecked(next);
  }
  // 요청 접수(연출) — 실제 revoke 없음. 데모 흐름상 안전도 62→85 전환 후 대시보드로.
  function submitRequest() {
    setConfirmOpen(false);
    markCleaned();
    router.push('/dashboard');
  }

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>정리하기</h1>
          <span className="badge warn-badge">{candidates.length}건 대기</span>
        </div>
      </div>

      {/* 탭 */}
      <div className="chip-row" role="group" aria-label="정리 방식">
        <button type="button" className={`chip${tab === 'unlink' ? ' active' : ''}`} onClick={() => setTab('unlink')}>
          연결앱 정리
        </button>
        <button type="button" className={`chip${tab === 'delete' ? ' active' : ''}`} onClick={() => setTab('delete')}>
          삭제 요청
        </button>
      </div>

      {tab === 'unlink' ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3>안 쓰는 연결 일괄 정리</h3>
                <p className="panel-note">6개월 이상 안 쓴 연결 {candidates.length}개</p>
              </div>
              <button type="button" className="btn btn-secondary compact" onClick={selectAll}>
                {candidates.length}개 일괄 선택
              </button>
            </div>

            <p className="list-label">연결 해제 대상</p>

            <div>
              {candidates.map((c) => (
                <label className="cleanup-item" key={c.id}>
                  <input type="checkbox" checked={!!checked[c.id]} onChange={() => toggle(c.id)} />
                  <ServiceAvatar service={c.service} />
                  <span className="cleanup-info">
                    <strong>{c.service}</strong>
                    <span>{c.unusedMonths}개월 미사용</span>
                  </span>
                  <span className="cleanup-method">{linkMethodLabel[c.linkMethod]}</span>
                </label>
              ))}
            </div>
          </section>

          {/* 하단 액션 바 */}
          <div className="action-bar">
            <span className="count">
              <strong>{selCount}</strong>개 앱 연결 해제 요청
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              요청 접수
            </button>
          </div>
        </>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h3>삭제 요청 현황</h3>
            <span className="panel-note">표준 절차 접수 {deleteRequests.length}건</span>
          </div>
          <ul className="activity">
            {deleteRequests.map((r) => (
              <li key={r.id}>
                <span className="act-text">
                  <i className={`dot ${reqDot[requestTone(r.status)]}`} aria-hidden="true" />
                  {r.service}
                </span>
                <time>
                  {r.status} · {r.eta}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 확인 모달 — 비가역 게이트(요청만 접수, 실제 해제 없음) */}
      {confirmOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setConfirmOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-confirm-title">
            <h3 id="modal-confirm-title">{selCount}개 앱 연결 해제를 요청하시겠어요?</h3>
            <p>실제 연결 해제 처리는 로드맵 단계입니다. 지금은 요청만 접수됩니다.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={submitRequest}>
                요청 접수
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
