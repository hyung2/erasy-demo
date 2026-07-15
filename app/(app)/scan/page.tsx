'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServiceAvatar } from '@/components/ServiceAvatar';
import { CountUp } from '@/components/CountUp';
import {
  accounts,
  deriveRisk,
  sortByRiskDesc,
  riskLabel,
  riskClass,
  deriveLastUsed,
  linkMethodLabel,
  socialCount,
  overseasCount,
} from '@/lib/dummy-data';
import { DISCOVERY_PATHS, linksByPath, type DiscoveryPath } from '@/lib/deep-links';

type Filter = 'all' | 'social' | 'overseas' | 'unused';

// 발견 삼각형 3경로 노출 순서(간편가입 → 직접가입 → 유출).
const PATH_ORDER: DiscoveryPath[] = ['provider-linked', 'self-verify', 'breach-lookup'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'social', label: '소셜' },
  { key: 'overseas', label: '해외' },
  { key: 'unused', label: '미사용' },
];

export default function ScanPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  // 정리 요청 접수된 서비스(연출) — 실제 revoke 없음. 상태만 로컬 반영.
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // 확인 모달 대상 id 목록(단건=1개, 일괄=선택 다수). 비어 있으면 닫힘.
  const [confirmIds, setConfirmIds] = useState<string[]>([]);

  // 필터 적용 후 위험도 높음→중간→낮음 정렬(deriveRisk 파생 — 하드코딩 금지).
  const rows = useMemo(
    () =>
      sortByRiskDesc(
        accounts.filter((a) => {
          if (filter === 'social') return a.category === 'social';
          if (filter === 'overseas') return a.category === 'overseas';
          if (filter === 'unused') return a.unusedMonths >= 12;
          return true;
        }),
      ),
    [filter],
  );

  const selectable = rows.filter((a) => !requested[a.id]);
  const selCount = selectable.filter((a) => checked[a.id]).length;
  const allSelected = selectable.length > 0 && selCount === selectable.length;

  function toggle(id: string) {
    setChecked((p) => ({ ...p, [id]: !p[id] }));
  }
  function toggleAll() {
    const next: Record<string, boolean> = { ...checked };
    selectable.forEach((a) => (next[a.id] = !allSelected));
    setChecked(next);
  }
  function openBulk() {
    const ids = selectable.filter((a) => checked[a.id]).map((a) => a.id);
    if (ids.length > 0) setConfirmIds(ids);
  }
  function openSingle(id: string) {
    setConfirmIds([id]);
  }
  // 요청 접수(연출) — 실제 연결 해제 없음. 상태만 요청됨으로 반영.
  function confirmRequest() {
    setRequested((p) => {
      const next = { ...p };
      confirmIds.forEach((id) => (next[id] = true));
      return next;
    });
    setChecked((p) => {
      const next = { ...p };
      confirmIds.forEach((id) => (next[id] = false));
      return next;
    });
    setConfirmIds([]);
  }

  const modalCount = confirmIds.length;

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>계정 스캔</h1>
        </div>
        <div className="head-right">
          <span className="head-meta">
            마지막 스캔 <time dateTime="2026-07-08">어제 21:04</time>
          </span>
          <button
            type="button"
            className="btn btn-primary compact"
            onClick={() => router.push('/scanning?return=/scan')}
          >
            다시 스캔
          </button>
        </div>
      </div>

      <div className="stat-grid cols3">
        <div className="stat">
          <div className="lbl">연결 계정</div>
          <div className="num">
            <CountUp value={accounts.length} />
          </div>
          <div className="delta">지난주 대비 +2</div>
        </div>
        <div className="stat">
          <div className="lbl">소셜 로그인</div>
          <div className="num">
            <CountUp value={socialCount} />
          </div>
          <div className="delta">전체의 {Math.round((socialCount / accounts.length) * 100)}%</div>
        </div>
        <div className="stat is-warn">
          <div className="lbl">해외 서비스</div>
          <div className="num">
            <CountUp value={overseasCount} />
          </div>
          <div className="delta">전체의 {Math.round((overseasCount / accounts.length) * 100)}%</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="chip-row" role="group" aria-label="계정 필터">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 계정 테이블 */}
      <section className="panel">
        <div className="panel-head">
          <h3>연결된 계정</h3>
          <div className="legend">
            <span className="legend-item">
              <i className="dot is-danger" aria-hidden="true" />
              높음
            </span>
            <span className="legend-item">
              <i className="dot is-caution" aria-hidden="true" />
              중간
            </span>
            <span className="legend-item">
              <i className="dot is-safe" aria-hidden="true" />
              낮음
            </span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="cb-cell">
                  <input
                    type="checkbox"
                    aria-label="표시된 계정 전체 선택"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={toggleAll}
                  />
                </th>
                <th scope="col">서비스</th>
                <th scope="col">연결 방식</th>
                <th scope="col">마지막 사용</th>
                <th scope="col">위험도</th>
                <th scope="col">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const r = deriveRisk(a);
                const isReq = !!requested[a.id];
                return (
                  <tr key={a.id} className={isReq ? 'is-requested' : ''}>
                    <td className="cb-cell">
                      <input
                        type="checkbox"
                        aria-label={`${a.service} 선택`}
                        checked={!!checked[a.id]}
                        disabled={isReq}
                        onChange={() => toggle(a.id)}
                      />
                    </td>
                    <td>
                      <span className="svc">
                        <ServiceAvatar service={a.service} />
                        {a.service}
                      </span>
                    </td>
                    <td>{linkMethodLabel[a.linkMethod]}</td>
                    <td>{deriveLastUsed(a)}</td>
                    <td>
                      <span className={`risk ${riskClass(r)}`}>{riskLabel[r]}</span>
                    </td>
                    <td>
                      {isReq ? (
                        <span className="req-tag">요청됨</span>
                      ) : (
                        <button type="button" className="btn-sm" onClick={() => openSingle(a.id)}>
                          정리
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 놓친 계정 찾기 — 발견 삼각형 3경로(외부 관리 페이지 안내). 자동 조회 아님·본인 확인. */}
      <section className="panel" aria-label="놓친 계정 찾기">
        <div className="panel-head">
          <div>
            <h3>놓친 계정 찾기</h3>
            <p className="panel-note">
              스캔에 안 잡힌 계정은 아래에서 직접 확인해 보세요. 우리가 대신 조회하지 않습니다.
            </p>
          </div>
        </div>

        {PATH_ORDER.map((path) => {
          const meta = DISCOVERY_PATHS[path];
          const links = linksByPath(path);
          return (
            <div className="discovery-path" key={path}>
              <div className="discovery-head">
                <h4>{meta.title}</h4>
              </div>
              <p className="discovery-guide">{meta.guide}</p>
              <div className="discovery-links">
                {links.map((l) => (
                  <a
                    key={l.id}
                    className="btn btn-secondary compact"
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.description}
                  >
                    {l.label}
                    <span className="ext-arrow" aria-hidden="true">
                      ↗
                    </span>
                    <span className="sr-only">(새 탭에서 열림)</span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}

        <div className="discovery-add">
          <button type="button" className="btn btn-secondary" disabled>
            몰랐던 계정 추가
          </button>
          <p className="discovery-add-note">
            확인한 계정 중 목록에 없던 것을 직접 추가할 수 있어요. (직접 추가 입력은 준비 중 · W4)
          </p>
        </div>
      </section>

      {/* 선택 일괄 정리 액션 바 */}
      {selCount > 0 && (
        <div className="action-bar">
          <span className="count">
            <strong>{selCount}</strong>개 계정 연결 해제 요청
          </span>
          <button type="button" className="btn btn-primary" onClick={openBulk}>
            선택 일괄 정리
          </button>
        </div>
      )}

      {/* 확인 모달 — 비가역 게이트(요청만 접수, 실제 해제 없음) */}
      {modalCount > 0 && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setConfirmIds([])}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="scan-confirm-title">
            <h3 id="scan-confirm-title">{modalCount}개 계정 연결 해제를 요청하시겠어요?</h3>
            <p>실제 연결 해제 처리는 로드맵 단계입니다. 지금은 요청만 접수됩니다.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmIds([])}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmRequest}>
                요청 접수
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
