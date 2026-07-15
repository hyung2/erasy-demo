'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServiceAvatar } from '@/components/ServiceAvatar';
import { CountUp } from '@/components/CountUp';
import { riskLabel, riskClass, type Risk } from '@/lib/dummy-data';
import { DISCOVERY_PATHS, linksByPath, type DiscoveryPath } from '@/lib/deep-links';
import type { AccountDTO, LastUsedBucket, AccountUpdateRequest } from '@/lib/api-types';

type Filter = 'all' | 'social' | 'overseas' | 'unused';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'social', label: '소셜' },
  { key: 'overseas', label: '해외' },
  { key: 'unused', label: '미사용' },
];

// 발견 삼각형 3경로 노출 순서(간편가입 → 직접가입 → 유출).
const PATH_ORDER: DiscoveryPath[] = ['provider-linked', 'self-verify', 'breach-lookup'];

// provider → 연결 방식 라벨(AccountDTO는 linkMethod 대신 provider 제공).
const PROVIDER_LABEL: Record<AccountDTO['provider'], string> = {
  google: '구글 로그인',
  naver: '네이버 로그인',
  kakao: '카카오 로그인',
  apple: '애플 로그인',
  manual: '이메일 · 비밀번호',
};

// 마지막 사용 버킷 드롭다운 옵션.
const BUCKET_OPTIONS: { value: LastUsedBucket; label: string }[] = [
  { value: 'within1y', label: '1년 이내' },
  { value: '1to2y', label: '1~2년' },
  { value: 'over2y', label: '2년 이상' },
  { value: 'unknown', label: '모름' },
];

const riskRank: Record<Risk, number> = { high: 2, medium: 1, low: 0 };

function lastUsedLabel(d: number): string {
  if (d >= 3650) return '미상';
  if (d < 1) return '오늘';
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.round(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 현재 lastUsedDays → 드롭다운 기본 버킷(근사 역매핑. 3650=null 센티넬 → 모름).
function daysToBucket(d: number): LastUsedBucket {
  if (d >= 3650) return 'unknown';
  if (d < 365) return 'within1y';
  if (d < 730) return '1to2y';
  return 'over2y';
}

// 자가신고 폼 상태.
type SelfReport = {
  passwordReused: boolean;
  twoFactorEnabled: boolean;
  lastUsedBucket: LastUsedBucket;
  discovered: boolean;
};

export default function ScanPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  // 계정 인벤토리 — 실 API(/api/accounts) 소비. seed 폴백 시 24계정(source:'seed').
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [score, setScore] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 정리 요청 접수된 서비스(연출) — 실제 revoke 없음. 상태만 로컬 반영.
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [confirmIds, setConfirmIds] = useState<string[]>([]);

  // 자가신고 모달 대상 id + 폼. 직접추가 모달.
  const [reportId, setReportId] = useState<string | null>(null);
  const [form, setForm] = useState<SelfReport | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadAccounts() {
    try {
      const r = await fetch('/api/accounts');
      if (!r.ok) throw new Error(String(r.status));
      const body: { data: AccountDTO[] } = await r.json();
      setAccounts(body.data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }

  // 점수 재계산 트리거 + 결과 회수(자가신고/추가 직후 즉시 반영 확인).
  async function refreshScore(): Promise<number | null> {
    try {
      const r = await fetch('/api/score');
      if (!r.ok) return null;
      const body: { data: { score: number } } = await r.json();
      setScore(body.data.score);
      return body.data.score;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void (async () => {
      await loadAccounts();
      await refreshScore();
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const socialCount = accounts.filter((a) => a.category === 'social').length;
  const overseasCount = accounts.filter((a) => a.category === 'overseas').length;

  // 필터 → 위험도 정렬(DTO risk 필드 사용, 하드코딩 금지). 동률은 미사용 오래된 순.
  const rows = useMemo(
    () =>
      [...accounts]
        .filter((a) => {
          if (filter === 'social') return a.category === 'social';
          if (filter === 'overseas') return a.category === 'overseas';
          if (filter === 'unused') return a.lastUsedDays >= 365;
          return true;
        })
        .sort((a, b) => {
          const d = riskRank[b.risk] - riskRank[a.risk];
          return d !== 0 ? d : b.lastUsedDays - a.lastUsedDays;
        }),
    [accounts, filter],
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

  // ── 자가신고 ──
  function openReport(a: AccountDTO) {
    setReportId(a.id);
    setForm({
      passwordReused: a.passwordReused ?? false,
      twoFactorEnabled: a.twoFactorEnabled ?? false,
      lastUsedBucket: daysToBucket(a.lastUsedDays),
      discovered: a.discovered ?? false,
    });
  }
  async function saveReport() {
    if (!reportId || !form) return;
    setSaving(true);
    const payload: AccountUpdateRequest = {
      passwordReused: form.passwordReused,
      twoFactorEnabled: form.twoFactorEnabled,
      lastUsedBucket: form.lastUsedBucket,
      discovered: form.discovered,
    };
    try {
      const r = await fetch(`/api/accounts/${reportId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        setReportId(null);
        setForm(null);
        await loadAccounts();
        const next = await refreshScore();
        setToast(next !== null ? `자가신고 반영 · 안전도 재계산 ${next}점` : '자가신고 반영됨');
      } else if (r.status === 404) {
        setToast('데모 시드 계정은 편집할 수 없어요(읽기 전용).');
      } else {
        setToast('저장에 실패했어요. 다시 시도해 주세요.');
      }
    } catch {
      setToast('네트워크 오류로 저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  // ── 몰랐던 계정 직접 추가 ──
  async function saveAdd() {
    const name = addName.trim();
    if (name.length === 0) return;
    setSaving(true);
    try {
      const r = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        setAddOpen(false);
        setAddName('');
        await loadAccounts();
        const next = await refreshScore();
        setToast(next !== null ? `“${name}” 추가 · 안전도 재계산 ${next}점` : `“${name}” 추가됨`);
      } else {
        setToast('추가에 실패했어요. 로그인 상태를 확인해 주세요.');
      }
    } catch {
      setToast('네트워크 오류로 추가하지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  const modalCount = confirmIds.length;
  const reportAccount = accounts.find((a) => a.id === reportId) ?? null;

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>계정 스캔</h1>
        </div>
        <div className="head-right">
          {score !== null && (
            <span className="head-meta">
              현재 안전도 <strong>{score}</strong>점
            </span>
          )}
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
          <div className="delta">확인된 계정 전체</div>
        </div>
        <div className="stat">
          <div className="lbl">소셜 로그인</div>
          <div className="num">
            <CountUp value={socialCount} />
          </div>
          <div className="delta">
            전체의 {accounts.length ? Math.round((socialCount / accounts.length) * 100) : 0}%
          </div>
        </div>
        <div className="stat is-warn">
          <div className="lbl">해외 서비스</div>
          <div className="num">
            <CountUp value={overseasCount} />
          </div>
          <div className="delta">
            전체의 {accounts.length ? Math.round((overseasCount / accounts.length) * 100) : 0}%
          </div>
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

        {loadState === 'error' ? (
          <p className="panel-note">계정을 불러오지 못했어요. 로그인 상태를 확인해 주세요.</p>
        ) : (
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
                  const isReq = !!requested[a.id];
                  const selfInput = a.source === 'user_input';
                  return (
                    <tr key={a.id} className={isReq ? 'is-requested' : ''}>
                      <td className="cb-cell">
                        <input
                          type="checkbox"
                          aria-label={`${a.name} 선택`}
                          checked={!!checked[a.id]}
                          disabled={isReq}
                          onChange={() => toggle(a.id)}
                        />
                      </td>
                      <td>
                        <span className="svc">
                          <ServiceAvatar service={a.name} />
                          {a.name}
                          {selfInput && <span className="badge self-input">직접 입력</span>}
                        </span>
                      </td>
                      <td>{PROVIDER_LABEL[a.provider]}</td>
                      <td>{lastUsedLabel(a.lastUsedDays)}</td>
                      <td>
                        <span className={`risk ${riskClass(a.risk)}`}>{riskLabel[a.risk]}</span>
                      </td>
                      <td>
                        <span className="row-actions">
                          <button type="button" className="btn-sm" onClick={() => openReport(a)}>
                            자가신고
                          </button>
                          {isReq ? (
                            <span className="req-tag">요청됨</span>
                          ) : (
                            <button type="button" className="btn-sm" onClick={() => openSingle(a.id)}>
                              정리
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
          <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(true)}>
            몰랐던 계정 추가
          </button>
          <p className="discovery-add-note">
            확인한 계정 중 목록에 없던 것을 직접 추가하면 안전도에 함께 반영됩니다.
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

      {/* 자가신고 모달 */}
      {reportAccount && form && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setReportId(null)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <h3 id="report-title">{reportAccount.name} 자가신고</h3>
            <p className="modal-note">직접 아는 정보를 입력하면 안전도에 바로 반영돼요.</p>

            <label className="report-row">
              <span>같은 비밀번호를 다른 곳에도 쓰나요?</span>
              <input
                type="checkbox"
                checked={form.passwordReused}
                onChange={(e) => setForm({ ...form, passwordReused: e.target.checked })}
              />
            </label>
            <label className="report-row">
              <span>2단계 인증(2FA)을 켜뒀나요?</span>
              <input
                type="checkbox"
                checked={form.twoFactorEnabled}
                onChange={(e) => setForm({ ...form, twoFactorEnabled: e.target.checked })}
              />
            </label>
            <label className="report-row">
              <span>마지막으로 언제 썼나요?</span>
              <select
                value={form.lastUsedBucket}
                onChange={(e) =>
                  setForm({ ...form, lastUsedBucket: e.target.value as LastUsedBucket })
                }
              >
                {BUCKET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="report-row">
              <span>몰랐던 계정인가요?</span>
              <input
                type="checkbox"
                checked={form.discovered}
                onChange={(e) => setForm({ ...form, discovered: e.target.checked })}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setReportId(null)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={saveReport} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 몰랐던 계정 추가 모달 */}
      {addOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <h3 id="add-title">몰랐던 계정 추가</h3>
            <p className="modal-note">외부 확인에서 발견한 계정의 서비스명을 입력하세요.</p>
            <label className="report-row">
              <span className="sr-only">서비스명</span>
              <input
                type="text"
                className="text-input"
                placeholder="예: 옥션, 티몬"
                value={addName}
                maxLength={60}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveAdd()}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveAdd}
                disabled={saving || addName.trim().length === 0}
              >
                {saving ? '추가 중…' : '추가'}
              </button>
            </div>
          </div>
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

      {/* 토스트(자가신고·추가 결과) */}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
