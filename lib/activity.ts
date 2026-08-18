/**
 * 활동 피드 — 이 사용자에게 **실제로 일어난 일**만 모은다.
 *
 * 예전에는 dummy-data의 activityFeed를 그대로 내려보냈다. 그래서 방금 가입한 사람도
 * "Quora 유출 정황 발견 · 2시간 전", "싸이월드 연결 해제 요청 완료 · 어제"를 자기 이력으로
 * 읽었다(2026-08-18 실측). 심사위원이 각자 계정으로 들어오는 화면이라 지어낸 이력을
 * 둘 수 없다.
 *
 * 재료는 이미 DB에 있다 — 계정이 언제 담겼는지(Account.createdAt), 언제 확인했는지
 * (acknowledgedAt), 정리를 언제 접수·완료했는지(CleanupRequest). 없으면 없는 대로 빈 배열을
 * 돌려주고, 화면이 "아직 활동이 없다"고 말한다.
 */
import type { PrismaClient } from '@prisma/client';
import type { AlertDTO } from './api-types';

/** "3분 전" 같은 상대 표기. 지어내지 않고 실제 시각에서만 계산한다. */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day === 1) return '어제';
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}개월 전`;
  return `${Math.floor(month / 12)}년 전`;
}

/** 같은 배치로 들어온 계정을 한 줄로 묶기 위한 기준(초). 스캔 한 번이 여러 행을 만든다. */
const BATCH_WINDOW_MS = 60_000;

type Row = { at: Date; item: Omit<AlertDTO, 'when'> };

/** 출처별 발견 문구. 무엇이 계정을 데려왔는지 그대로 적는다. */
const DISCOVERY_LABEL: Record<string, string> = {
  mail_scan: '메일함 스캔',
  social_link: '소셜 연결목록 가져오기',
  user_input: '직접 추가',
  oauth_linked: '로그인 계정 연결',
};

export async function buildActivityFeed(
  db: PrismaClient,
  userId: string,
  limit = 8,
): Promise<AlertDTO[]> {
  const [accounts, requests, breaches] = await Promise.all([
    db.account.findMany({
      where: { userId },
      select: { id: true, name: true, source: true, createdAt: true, acknowledgedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.cleanupRequest.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        completedAt: true,
        account: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // 배치로 접으므로 넉넉히 읽는다 — 20건 일괄 담기가 한 줄이 된다
    }),
    db.breach.findMany({
      where: { userId, resolved: false },
      select: { id: true, service: true },
      take: 5,
    }),
  ]);

  const rows: Row[] = [];

  // 발견 — 같은 스캔에서 들어온 계정은 한 줄로 묶는다. 60개를 60줄로 늘어놓으면 피드가 아니다.
  const batches = new Map<string, { at: Date; source: string; count: number }>();
  for (const a of accounts) {
    const bucket = Math.floor(a.createdAt.getTime() / BATCH_WINDOW_MS);
    const key = `${a.source}:${bucket}`;
    const prior = batches.get(key);
    if (prior) prior.count += 1;
    else batches.set(key, { at: a.createdAt, source: a.source, count: 1 });
  }
  for (const [key, b] of batches) {
    if (b.source === 'seed') continue; // 우리가 심은 예시는 사용자의 활동이 아니다
    rows.push({
      at: b.at,
      item: {
        id: `discovery:${key}`,
        type: 'discovery',
        message: `${DISCOVERY_LABEL[b.source] ?? b.source}으로 계정 ${b.count}개를 찾았어요`,
        tone: 'neutral',
      },
    });
  }

  // 확인 처리 — 여러 건을 한 번에 누르므로 역시 묶는다.
  const ackBatches = new Map<number, { at: Date; count: number }>();
  for (const a of accounts) {
    if (!a.acknowledgedAt) continue;
    const bucket = Math.floor(a.acknowledgedAt.getTime() / BATCH_WINDOW_MS);
    const prior = ackBatches.get(bucket);
    if (prior) prior.count += 1;
    else ackBatches.set(bucket, { at: a.acknowledgedAt, count: 1 });
  }
  for (const [bucket, b] of ackBatches) {
    rows.push({
      at: b.at,
      item: {
        id: `ack:${bucket}`,
        type: 'acknowledge',
        message: `계정 ${b.count}개를 확인했어요 — 모르고 있던 위험이 그만큼 줄었어요`,
        tone: 'success',
      },
    });
  }

  // 정리 접수·완료 — 접수는 "담았다"이지 "끝냈다"가 아니라서 문구를 나눈다.
  // 일괄 담기가 기본이라 한 번에 20건이 들어온다. 개별로 늘어놓으면 피드가 그 한 동작으로
  // 도배돼 정작 무엇을 찾았는지가 밀려난다 — 같은 배치는 한 줄로 접는다.
  const queueBatches = new Map<number, { at: Date; names: string[] }>();
  const doneBatches = new Map<number, { at: Date; names: string[] }>();
  for (const r of requests) {
    const qb = Math.floor(r.createdAt.getTime() / BATCH_WINDOW_MS);
    const q = queueBatches.get(qb);
    if (q) q.names.push(r.account.name);
    else queueBatches.set(qb, { at: r.createdAt, names: [r.account.name] });

    if (r.completedAt) {
      const db_ = Math.floor(r.completedAt.getTime() / BATCH_WINDOW_MS);
      const d = doneBatches.get(db_);
      if (d) d.names.push(r.account.name);
      else doneBatches.set(db_, { at: r.completedAt, names: [r.account.name] });
    }
  }

  /** 한 줄에 이름을 다 나열하면 읽히지 않는다 — 두 개까지만 적고 나머지는 수로 말한다. */
  const summarize = (names: string[]) =>
    names.length <= 2 ? names.join(' · ') : `${names.slice(0, 2).join(' · ')} 외 ${names.length - 2}개`;

  for (const [bucket, b] of queueBatches) {
    rows.push({
      at: b.at,
      item: {
        id: `queued:${bucket}`,
        type: 'recleanup',
        message: `${summarize(b.names)} 정리를 목록에 담았어요`,
        tone: 'neutral',
      },
    });
  }
  for (const [bucket, b] of doneBatches) {
    rows.push({
      at: b.at,
      item: {
        id: `done:${bucket}`,
        type: 'recleanup',
        message: `${summarize(b.names)} 정리를 끝냈어요`,
        tone: 'success',
      },
    });
  }

  const now = new Date();
  const feed = rows
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map(({ at, item }) => ({ ...item, when: relativeTime(at, now) }));

  // 미해결 유출은 시각이 없다(유출 시점은 사건 발생일이지 우리가 안 날이 아니다).
  // 그래서 상대 시각 대신 상태로만 얹는다.
  if (breaches.length > 0) {
    feed.unshift({
      id: `breach:${breaches.map((b) => b.id).join(',')}`,
      type: 'breach',
      message: `유출 이력이 있는 계정 ${breaches.length}개가 아직 정리되지 않았어요`,
      when: '확인 필요',
      tone: 'error',
    });
  }

  return feed.slice(0, limit);
}
