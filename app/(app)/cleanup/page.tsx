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
import { primaryLink } from '@/lib/deep-links';

type Tab = 'unlink' | 'delete';

// 정리 화면 대표 딥링크 — 유출 점검이 정리 전 첫 확인 지점(과투자 금지, 단일 노출).
const breachCheck = primaryLink('kidc-breach');

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
  // 요청 접수(연출) — 실제 revoke 없음. 데모 흐름상 안전도 24→90 전환 → 결과 화면(Before/After).
  function submitRequest() {
    setConfirmOpen(false);
    markCleaned();
    router.push('/cleanup/result');
  }

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>계정 정리</h1>
          <span className="badge warn-badge">{candidates.length}건 대기</span>
        </div>
      </div>
      <p className="page-sub">안 쓰는 소셜 연결을 끊고, 삭제가 필요한 계정은 요청하세요.</p>

      {/* 탭 */}
      <div className="chip-row" role="group" aria-label="정리 방식">
        <button type="button" className={`chip${tab === 'unlink' ? ' active' : ''}`} onClick={() => setTab('unlink')}>
          소셜 연결 끊기
        </button>
        <button type="button" className={`chip${tab === 'delete' ? ' active' : ''}`} onClick={() => setTab('delete')}>
          계정 삭제 요청
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

            {/* 액션 설명 슬롯(임시 카피 — Joy 맵 확정 후 교체) */}
            <p className="action-desc">
              선택한 연결을 OAuth 표준 방식으로 해제 요청합니다. 지금은 요청만 접수되고, 실제 해제는 로드맵 단계입니다.
            </p>

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
