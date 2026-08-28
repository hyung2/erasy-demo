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
import {
  collectViaExtension,
  detectExtension,
  EXTENSION_STORE_URL,
  onExtensionReady,
  probeLoginState,
} from '@/lib/extension-bridge';

const PROVIDERS: Array<{
  id: ImportProvider;
  label: string;
  href: string;
  hint: string;
  /**
   * 로그인이 필요할 때 보내는 주소. 확장이 보내 주는 loginUrl을 쓰지 않고 여기 것을 쓴다 —
   * 설치된 구버전 확장(0.1.0)이 카카오를 파라미터 없는 `/login`으로 보내는데, 카카오는
   * continue 없는 로그인 요청을 400으로 튕긴다(2026-08-28 실측: 307 → /v2/error/400).
   * 확장은 크롬이 알아서 올릴 때까지 옛 주소를 들고 있으므로, 앱이 덮어써야 오늘 고쳐진다.
   * continue/url로 연결목록 화면을 지정해, 로그인이 끝나면 볼 일 있는 화면에 내려 준다.
   */
  loginHref: string;
}> = [
  {
    id: 'google',
    label: '구글',
    href: 'https://myaccount.google.com/connections',
    hint: '보안 > 타사 앱 및 서비스 > 모든 연결 보기',
    loginHref: 'https://accounts.google.com/signin',
  },
  {
    id: 'kakao',
    label: '카카오',
    href: 'https://accounts.kakao.com/weblogin/account/partner',
    hint: '카카오계정 > 연결된 서비스 관리',
    // 링크 전용 주소는 loginHref와 같은 행에 둔다 — verify-csp-hosts가 행 단위로 href 여부를 판별한다.
    loginHref: 'https://accounts.kakao.com/login?continue=' + encodeURIComponent('https://apps.kakao.com/connected/app/list?lang=ko&service_type=kakao'),
  },
  {
    id: 'naver',
    label: '네이버',
    href: 'https://nid.naver.com/user2/help/myInfo',
    hint: '네이버 내정보 > 외부 사이트 연결',
    // 파라미터 없는 nidlogin.login은 봇 차단·오류 화면이 섞여 나온다(실측 503). url을 준다.
    loginHref: 'https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent('https://nid.naver.com/internalToken/view/tokenList/pc/ko'),
  },
];

/** 이번 목록에서 사라진 계정 — 제공사 화면에서 끊고 온 것으로 보이는 후보. */
type MissingConnection = { accountId: string; name: string };

/** 찾자마자 펼쳐 두는 항목 수. 숫자만 보고 누르지 않도록 실제 이름을 먼저 보여준다. */
const PREVIEW_COUNT = 7;

/**
 * 확장을 얹기 위해 이 화면을 한 번 다시 읽었는가.
 *
 * 세션에 한 번만 한다. 설치하지 않고 웹스토어를 닫고 온 사람에게 돌아올 때마다 화면이
 * 새로 뜨면, 고치려던 것보다 나쁜 경험이 된다.
 */
const RELOAD_ONCE_KEY = 'erasy.ext.reloadTried';

/** 자동 감지가 몇 번 빗나가면 수동 확인 버튼을 꺼내는가. */
const MANUAL_AFTER_MISSES = 2;

/**
 * 화면이 지금 요구하는 단 하나의 행동.
 *
 * 이 값을 따로 두는 이유: 예전에는 "설치 안내"·"로그인 안내"·"가져오기"가 각자의 조건으로
 * 켜지고 꺼져서, 로그인이 필요할 때는 버튼이 둘(로그인하러 가기 · 다시 가져오기)로 갈렸다.
 * 사용자가 화면에서 읽어야 하는 것은 "지금 뭘 눌러야 하나" 하나뿐이고, 나머지는 우리가
 * 알아서 감지해야 한다.
 */
type Stage = 'checking' | 'install' | 'login' | 'collect';

type ImportResult = {
  provider: ImportProvider;
  submitted: number;
  createdCount: number;
  upgradedCount: number;
  unchangedCount: number;
  /** 서비스명이 아니라 버려진 수(날짜·순번 등). 서버가 마지막 관문에서 거른다. */
  rejectedCount?: number;
  missing: MissingConnection[];
};

export default function ConnectionImport({
  onApplied,
  lockedProvider,
  onNext,
  nextLabel,
}: {
  onApplied?: () => void;
  /**
   * 온보딩처럼 한 제공사씩 밟는 화면에서 쓴다. 칩을 숨기고 그 제공사만 다룬다 —
   * 단계를 나눠 놓고 칩으로 아무 데나 갈 수 있으면 "지금 어디를 하는 중인지"가 흐려진다.
   */
  lockedProvider?: ImportProvider;
  /**
   * 담기를 마친 자리에 바로 놓는 다음 걸음. 완료 메시지와 다음 버튼이 떨어져 있으면
   * "다 됐다"를 확인하고도 어디로 가야 할지 화면 아래를 찾게 된다.
   */
  onNext?: () => void;
  nextLabel?: string;
}) {
  const [provider, setProvider] = useState<ImportProvider>(lockedProvider ?? 'google');
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

  /**
   * 확장이 설치돼 있으면 자동 수집 경로가 열린다.
   *
   * 없을 때는 예전에 이 자리를 통째로 숨겼다. 웹스토어 게재 전이라 보낼 곳이 없었고,
   * 눌러도 안 되는 버튼보다는 나았다. 그런데 게재가 끝난 뒤에도 그대로여서 **확장을
   * 모르는 사람은 이 제품의 주 경로를 만날 길이 없었다.** 지금은 같은 자리에 설치로
   * 가는 문을 낸다 — 숨기면 사용자가 그런 길이 있다는 것조차 알 수 없다.
   */
  const [extProviders, setExtProviders] = useState<string[]>([]);
  /** 확인이 끝났는가. 끝나기 전에 설치 안내를 띄우면 이미 설치한 사람에게 잠깐 깜빡인다. */
  const [extChecked, setExtChecked] = useState(false);
  const [collecting, setCollecting] = useState(false);
  /** 해당 제공사에 로그인이 안 돼 있는 상태. 실패와 구분해 갈 곳을 알려 준다. */
  const [needsLogin, setNeedsLogin] = useState<{ loginUrl: string | null } | null>(null);
  /** 웹스토어를 열어 본 사람인가 — 열지도 않은 사람의 화면을 마음대로 다시 읽지 않는다. */
  const [storeOpened, setStoreOpened] = useState(false);
  /** 자동 감지가 빗나간 횟수. 쌓이면 수동 확인 버튼을 꺼내 준다 — 자동화가 막다른 길이 되면 안 된다. */
  const [autoMisses, setAutoMisses] = useState(0);

  const parsed = useMemo(() => (text.trim() ? parseConnectionList(text) : null), [text]);

  const isChecked = (item: ParsedConnection) => item.preselected && !excluded.has(item.name);
  const selected = parsed?.items.filter(isChecked) ?? [];
  const warned = parsed?.items.filter((i) => i.warning) ?? [];
  /** 찾았지만 기본 선택에서 빠진 수 — 화면이 그 차이를 설명해야 한다. */
  const excludedCount = (parsed?.items.length ?? 0) - selected.length;
  /** 그중 우리 앱 자신(파서가 preselected=false로 둔 것). 가장 흔한 사유다. */
  const excludedSelfCount = parsed?.items.filter((i) => !i.preselected).length ?? 0;

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

  /** 확장이 이 제공사를 지원하는가 — 주 동작과 예비 수단의 위계가 여기서 갈린다. */
  const canAutoCollect = extProviders.includes(provider);
  const stage: Stage = !extChecked
    ? 'checking'
    : !canAutoCollect
      ? 'install'
      : needsLogin
        ? 'login'
        : 'collect';

  // 확장이 자동으로 가져올 수 있는 제공사 목록. 확장이 없으면 빈 배열이고, 그때는
  //   같은 자리에 설치 안내가 선다.
  useEffect(() => {
    let alive = true;
    void detectExtension().then((v) => {
      if (!alive) return;
      setExtProviders(v);
      setExtChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 확장이 "나 여기 있다"고 알릴 때마다 받는다 — 처음 탐지 창이 닫힌 뒤에 오는 신호까지.
   *
   * 확장 0.2.0은 설치되는 순간 열려 있는 이레이지 탭을 스스로 다시 읽는다. 그 뒤 브리지가
   * 얹히면서 ready가 오는데, 듣는 귀가 없으면 그 신호가 그대로 버려진다.
   */
  useEffect(
    () =>
      onExtensionReady((v) => {
        setExtProviders(v);
        setExtChecked(true);
      }),
    [],
  );

  /**
   * 확장으로 한 번에 가져오기.
   * 확장이 백그라운드 탭에서 연결목록 페이지를 열어 **서비스 이름만** 읽고 닫는다.
   * 결과는 붙여넣기와 똑같이 미리보기를 거친다 — 자동으로 왔다고 확인 없이 저장하지 않는다.
   *
   * silent: 자동 재시도에서 쓴다. 사용자가 누르지 않은 시도가 실패했다고 붉은 오류를
   * 띄우면, 가만히 있었는데 뭔가 잘못됐다는 인상만 남는다.
   */
  const collectWithExtension = useCallback(
    async (opts?: { silent?: boolean }) => {
      setCollecting(true);
      if (!opts?.silent) setError(null);
      setResult(null);
      try {
        const res = await collectViaExtension(provider);
        if (!res.ok) {
          // 로그인이 필요한 경우는 "실패"가 아니라 "아직 못 한 일"이다. 문구도 갈 곳도 다르다.
          if (res.needsLogin) setNeedsLogin({ loginUrl: res.loginUrl ?? null });
          else if (!opts?.silent) setError(res.error);
          return;
        }
        setNeedsLogin(null);
        setText(res.names.join('\n'));
        setAwaitingReturn(false);
      } finally {
        setCollecting(false);
      }
    },
    [provider],
  );

  /**
   * 설치를 기다리는 동안 — 사용자가 이 탭으로 돌아오면 그때 확인한다.
   *
   * 여기서 "다시 확인"만으로 끝낼 수 없는 이유: 크롬은 **이미 열려 있는 탭에 content script를
   * 나중에 주입하지 않는다.** 설치 직후 이 탭에는 브리지가 없어서, 몇 번을 물어도 답할 상대가
   * 없다(예전 "설치했어요 · 다시 확인" 버튼이 원리상 성공할 수 없었던 이유다).
   * 확장 0.2.0은 설치되는 순간 스스로 이 탭을 다시 읽어 주지만, 스토어에 올라간 구버전은
   * 그러지 못한다. 그때는 앱이 화면을 한 번 다시 읽는다 — 사용자가 배워야 할 일이 아니다.
   */
  useEffect(() => {
    if (stage !== 'install' || !storeOpened) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const v = await detectExtension(1500);
      if (!alive) return;
      if (v.length > 0) {
        setExtProviders(v);
        setExtChecked(true);
        return;
      }
      setAutoMisses((n) => n + 1);
      if (sessionStorage.getItem(RELOAD_ONCE_KEY)) return;
      sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
      window.location.reload();
    };
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stage, storeOpened]);

  /**
   * 로그인을 기다리는 동안 — 다른 탭에서 로그인하면 이 화면이 스스로 바뀐다.
   *
   * 확장 0.2.0에는 탭을 열지 않는 값싼 조회(login-state)가 있어 2초마다 물어봐도 된다.
   * 구버전 확장은 그 규약을 모르므로, 사용자가 이 탭으로 돌아온 시점에 조용히 한 번 더
   * 가져와 본다 — 로그인 전이면 확장이 로그인 화면을 즉시 알아채고 끝내므로 조용히 실패한다.
   * 무한히 되풀이하지 않도록 세 번으로 끊는다.
   */
  useEffect(() => {
    if (stage !== 'login') return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let silentTries = 0;
    let lastSilentAt = 0;

    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const probe = async () => {
      if (!alive || document.visibilityState !== 'visible') return;
      const r = await probeLoginState(provider);
      if (!alive) return;
      if (r.supported) {
        if (r.loggedIn === true) setNeedsLogin(null);
        return;
      }
      // 구버전 확장 — 물을 길이 없으니 되풀이 조회는 낭비다. 돌아온 시점에만 시도한다.
      stopPolling();
      if (silentTries >= 3 || Date.now() - lastSilentAt < 4000) return;
      silentTries += 1;
      lastSilentAt = Date.now();
      setAutoMisses((n) => n + 1);
      await collectWithExtension({ silent: true });
    };

    const onVisible = () => void probe();
    document.addEventListener('visibilitychange', onVisible);
    void probe();
    timer = setInterval(() => void probe(), 2000);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      stopPolling();
    };
  }, [stage, provider, collectWithExtension]);

  /**
   * 자동 감지가 끝내 빗나갔을 때 꺼내는 수동 확인.
   *
   * 확인해서 없으면 화면을 다시 읽는다 — 이 탭에 브리지가 없는 상태에서는 그것 말고는
   * 확장을 얹을 방법이 없기 때문이다. "새로고침하세요"라고 시키는 대신 우리가 한다.
   */
  const [rechecking, setRechecking] = useState(false);
  async function recheckExtension() {
    if (rechecking) return;
    setRechecking(true);
    const v = await detectExtension(1500);
    if (v.length > 0) {
      setExtProviders(v);
      setExtChecked(true);
      setRechecking(false);
      return;
    }
    sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
    window.location.reload();
  }

  /** 연결 목록 창을 새로 띄우고, 돌아오는 시점을 잡아 안내를 올린다. */
  function openProviderPage() {
    setAwaitingReturn(true);
    setResult(null);
    window.open(current.href, '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    if (!awaitingReturn) return;
    // 창을 연 시각은 여기서 남긴다. 렌더 중에 Date.now를 부르면 리렌더마다 값이 달라져
    // 결과가 불안정해질 수 있다는 것이 React의 규칙이고, 아래 1500ms 임계는 그 사이의
    // 몇 밀리초 차이에 영향받지 않는다.
    openedAt.current = Date.now();
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
  /** 아직 미리보기·결과가 뜨기 전 — 이 구간에서만 "지금 할 행동 하나"를 보여준다. */
  const inActionPhase = !parsed && !result;

  return (
    <section className="panel" aria-labelledby="conn-import-title">
      {/* 온보딩에서는 페이지가 이미 제목과 안내를 주고 있어 여기서 또 하면 겹친다.
          그만큼 버튼이 스크롤 아래로 밀려, 화면을 열자마자 할 일이 안 보인다. */}
      {!lockedProvider && (
        <>
          <div className="breach-head">
            <h3 id="conn-import-title">간편가입한 서비스 가져오기</h3>
            <span className="badge live">실측</span>
          </div>

          <p className="score-sub">
            구글·카카오·네이버로 간편가입한 서비스 목록입니다. 연결 목록을 복사해 붙여넣으면 한
            번에 인벤토리에 담습니다. 어느 계정에서 가져왔는지 알기 때문에{' '}
            <strong>가입 방식이 추측이 아닌 사실로 기록</strong>됩니다.
          </p>
        </>
      )}

      {!lockedProvider && (
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
      )}

      {/* 로그인이 안 돼 있을 때. 이건 실패가 아니라 아직 못 한 일이라 붉은 오류로 다루지 않는다.
          버튼은 **로그인하러 가는 것 하나**뿐이다 — 로그인하고 돌아오는 일은 우리가 감지한다.
          예전에는 여기에 "로그인했어요 · 다시 가져오기"가 나란히 서서, 돌아온 사용자가
          둘 중 무엇을 눌러야 하는지 한 번 더 생각해야 했다. */}
      {inActionPhase && stage === 'login' && (
        <div className="needs-login">
          <p className="needs-login-title">{current.label}에 로그인이 필요해요</p>
          <p className="needs-login-note">
            연결목록은 <strong>{current.label} 계정에 로그인된 상태</strong>에서만 읽을 수
            있습니다. 아이디·비밀번호는 이레이지가 보지 않습니다.
          </p>
          <div className="needs-login-actions">
            <a
              className="btn btn-primary ext-collect-cta"
              href={current.loginHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {current.label} 로그인하러 가기 ↗<span className="sr-only">(새 탭에서 열림)</span>
            </a>
          </div>
          <p className="ext-collect-note" role="status">
            {collecting
              ? '로그인을 확인하는 중이에요…'
              : '로그인하시면 이 화면이 스스로 바뀝니다. 새로고침하지 않으셔도 됩니다.'}
          </p>
          {autoMisses >= MANUAL_AFTER_MISSES && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => void collectWithExtension()}
              disabled={collecting}
            >
              {collecting ? '확인 중…' : '로그인했어요 · 지금 확인'}
            </button>
          )}
        </div>
      )}

      {/* 원터치 — 확장이 이 제공사를 지원할 때의 **주 동작**. 화면에서 가장 크다.
          담고 나면(result) 사라진다. 남겨 두면 "또 눌러야 하나"를 한 번 더 생각하게 되고,
          정작 눌러야 할 다음 버튼과 경쟁한다. */}
      {inActionPhase && stage === 'collect' && (
        <div className="ext-collect">
          <button
            type="button"
            className="btn btn-primary ext-collect-cta"
            onClick={() => void collectWithExtension()}
            disabled={collecting}
          >
            {collecting ? '가져오는 중…' : `${current.label} 연결목록 한 번에 가져오기`}
          </button>
          <p className="ext-collect-note">
            아이디·비밀번호는 읽지 않습니다. 브라우저가 이미 로그인해 둔 화면에서{' '}
            <strong>서비스 이름만</strong> 가져옵니다.
          </p>
        </div>
      )}

      {/* 확장이 없을 때 — 같은 자리에 설치로 가는 문을 낸다. 숨기면 이 제품의 주 경로가
          있다는 것조차 알 수 없다. 아래 붙여넣기 경로는 그대로 열려 있으므로 설치는 강요가 아니다. */}
      {inActionPhase && stage === 'install' && (
        <div className="ext-collect">
          <a
            className="btn btn-primary ext-collect-cta"
            href={EXTENSION_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setStoreOpened(true)}
          >
            확장 설치하고 한 번에 가져오기 ↗<span className="sr-only">(새 탭에서 열림)</span>
          </a>
          <p className="ext-collect-note">
            확장이 {current.label} 연결목록을 <strong>한 번에</strong> 가져옵니다. 아이디·비밀번호는
            읽지 않고, 브라우저가 이미 로그인해 둔 화면에서 <strong>서비스 이름만</strong> 읽습니다.
            설치 없이 아래에서 목록을 붙여넣으셔도 됩니다.
          </p>
          {storeOpened && (
            <p className="ext-collect-note" role="status">
              설치가 끝나면 이 화면이 스스로 바뀝니다. 새로고침하지 않으셔도 됩니다.
            </p>
          )}
          {/* 자동 감지가 빗나갔을 때만 꺼낸다. 자동화가 막다른 길이 되면 안 되기 때문이고,
              처음부터 보여 주면 "결국 내가 눌러야 하는구나"로 읽힌다. */}
          {autoMisses >= MANUAL_AFTER_MISSES && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => void recheckExtension()}
              disabled={rechecking}
            >
              {rechecking ? '확인 중…' : '설치했어요 · 지금 확인'}
            </button>
          )}
        </div>
      )}

      {/* 수동 경로. 확장이 있으면 접어 두고 "안 될 때"라고 못박는다 — 예비 수단이 주 동작과
          같은 크기로 나란히 있으면 무엇을 먼저 눌러야 하는지가 사라진다. */}
      {inActionPhase &&
        stage !== 'checking' &&
        (stage !== 'install' ? (
          <details className="fallback-section">
            <summary>자동으로 가져오지 못했다면</summary>
            <div className="fallback-body">
              <p className="advice">
                {awaitingReturn
                  ? '연결 목록에서 전체 선택(Ctrl+A) 후 복사(Ctrl+C)하고 돌아와 "복사한 목록 담기"를 누르세요.'
                  : `${current.hint}에서 목록을 복사해 오면 됩니다.`}
              </p>
              <div className="fallback-actions">
                <button type="button" className="btn-sm" onClick={openProviderPage}>
                  {current.label} 연결 목록 열기 ↗
                </button>
                <button
                  type="button"
                  className={awaitingReturn ? 'btn-sm primary' : 'btn-sm'}
                  onClick={pasteFromClipboard}
                >
                  {awaitingReturn ? '복사한 목록 담기' : '복사한 목록 붙여넣기'}
                </button>
              </div>
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
            </div>
          </details>
        ) : (
          // 확장이 없으면 붙여넣기가 주 동작이다. 예비로 접어 두면 할 일이 안 보인다.
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <button type="button" className="btn btn-primary" onClick={openProviderPage}>
                {current.label} 연결 목록 열기
              </button>
              <button
                type="button"
                className={awaitingReturn ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={pasteFromClipboard}
              >
                {awaitingReturn ? '복사한 목록 담기' : '복사한 목록 붙여넣기'}
              </button>
            </div>
            <p className="advice">
              {awaitingReturn
                ? '연결 목록에서 전체 선택(Ctrl+A) 후 복사(Ctrl+C)하고 돌아와 "복사한 목록 담기"를 누르세요.'
                : `${current.hint}에서 목록을 복사해 오면 됩니다.`}
            </p>
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
          </>
        ))}

      {parsed && parsed.items.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="status safe" role="status">
            {parsed.items.length}개 서비스를 찾았습니다
            {parsed.mergedDuplicates > 0 && ` · 중복 ${parsed.mergedDuplicates}건은 하나로 합쳤습니다`}
          </p>

          {/* 찾은 수와 담을 수가 다르면 **왜 다른지** 함께 적는다.
              "46개 찾았습니다" 밑에 "45개 가져오기"만 있으면 하나가 어디로 샜는지 알 수 없다. */}
          {excludedCount > 0 && (
            <p className="advice">
              이 중 {excludedCount}개는 기본 제외했습니다
              {excludedSelfCount > 0 && ' — 이레이지 자신은 담을 필요가 없어요'}. 아래에서 다시
              선택할 수 있습니다.
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={pending || selected.length === 0}
            style={{ marginTop: 8 }}
          >
            {pending
              ? '가져오는 중…'
              : selected.length === parsed.items.length
                ? `${selected.length}개 모두 가져오기`
                : `${parsed.items.length}개 중 ${selected.length}개 가져오기`}
          </button>

          {warned.length > 0 && (
            <p className="advice" style={{ marginTop: 8 }}>
              직접 만든 프로젝트로 보이는 {warned.length}개가 섞여 있습니다. 일단 담고, 가져온
              뒤에 알려드립니다.
            </p>
          )}

          {/* 찾자마자 목록을 보여준다 — 숫자만 있으면 무엇을 담는지 모른 채 누르게 된다.
              앞의 몇 개는 항상 펼쳐 두고, 나머지는 필요할 때 연다. */}
          <ul className="scan-hits" style={{ marginTop: 10 }}>
            {(showDetails ? parsed.items : parsed.items.slice(0, PREVIEW_COUNT)).map((item) => (
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

          {parsed.items.length > PREVIEW_COUNT && (
            <button
              type="button"
              className="linklike"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              style={{ marginTop: 8 }}
            >
              {showDetails
                ? '목록 접기'
                : `나머지 ${parsed.items.length - PREVIEW_COUNT}개 더 보기`}
            </button>
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
          {/* 완료 문구는 "무엇을 했는가"로 시작한다. createdCount만 앞세우면 45개를 담아도
              전부 기존일 때 "몰랐던 계정 0개를 담았습니다"가 떠서 실패처럼 읽힌다. */}
          <p className="status safe" role="status">
            {result.provider === 'google'
              ? '구글'
              : result.provider === 'kakao'
                ? '카카오'
                : '네이버'}{' '}
            연결 서비스 {result.submitted}개를 모두 담았습니다
          </p>
          <p className="advice">
            {result.createdCount > 0 && `새로 찾은 계정 ${result.createdCount}개`}
            {result.createdCount > 0 && result.upgradedCount > 0 && ' · '}
            {result.upgradedCount > 0 && `가입 방식 확정 ${result.upgradedCount}개`}
            {(result.createdCount > 0 || result.upgradedCount > 0) &&
              result.unchangedCount > 0 &&
              ' · '}
            {result.unchangedCount > 0 && `이미 있던 계정 ${result.unchangedCount}개`}
          </p>

          {/* 담은 결과에 대한 이레이지의 코멘트 — 무엇을 어떻게 판단했는지 사용자에게
              그대로 말한다. 흩어진 안내 문구를 한 자리에 모아 "왜 이렇게 담겼는지"를
              읽히게 한다. 규칙에 따른 판단이며, 없는 근거를 만들어 붙이지 않는다. */}
          <section className="erasy-comment" aria-label="이레이지 코멘트">
            <span className="erasy-comment-badge">Erasy Comment</span>
            <ul className="erasy-comment-list">
              {(result.rejectedCount ?? 0) > 0 && (
                <li>
                  목록에 날짜·번호 같은 값이 {result.rejectedCount}개 섞여 있었어요. 서비스가
                  아니라서 담지 않았습니다.
                </li>
              )}
              {flagged.length > 0 && (
                <li>
                  {flagged.map((f) => f.name).join(', ')}
                  {flagged.length > 1 ? ` 등 ${flagged.length}개는` : '은(는)'} 직접 만드신
                  프로젝트로 보입니다. 계정 목록에서 지우시면 점수에서도 빠져요.
                </li>
              )}
              {result.unchangedCount > 0 && result.createdCount === 0 && (
                <li>
                  이번에는 새로 찾은 계정이 없었어요. {result.unchangedCount}개가 이미 목록에
                  있던 것이라, 중복으로 담지 않았습니다.
                </li>
              )}
              <li>
                연결 목록에는 마지막 사용일이 없어 활동일은 <strong>미상</strong>으로
                담았습니다. 언제 마지막으로 쓰셨는지는 지어내지 않아요 — 직접 알려주시면
                안전도에 반영됩니다.
              </li>
            </ul>
          </section>

          {/* 다음 걸음 — 확인할 것(사라진 항목)이 남아 있으면 그걸 먼저 처리하게 둔다. */}
          {onNext && result.missing.length === 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNext}
              style={{ marginTop: 12, width: '100%' }}
            >
              {nextLabel ?? '다음'}
            </button>
          )}

          {/* 온보딩 밖(계정 스캔)에서는 다음 걸음이 없다. 대신 되돌아갈 길을 둔다 —
              제공사에서 연결을 끊고 와 다시 가져오면 사라진 항목이 잡히는데,
              그 왕복이 이 화면의 핵심 기능이라 막아 두면 안 된다. */}
          {!onNext && (
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setResult(null);
                setMarkedCount(null);
                setFlagged([]);
                setNeedsLogin(null);
              }}
              style={{ marginTop: 12 }}
            >
              다시 가져오기
            </button>
          )}

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

          {/* 사라진 항목까지 처리한 뒤의 다음 걸음. 위 버튼과 조건이 겹치지 않는다. */}
          {onNext && result.missing.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNext}
              style={{ marginTop: 12, width: '100%' }}
            >
              {nextLabel ?? '다음'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
