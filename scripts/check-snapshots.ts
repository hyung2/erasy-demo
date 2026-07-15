// 읽기 전용: ScoreSnapshot 현황 확인 (purge 후 검증용)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const rows = await db.scoreSnapshot.findMany({
    orderBy: { createdAt: "asc" },
    select: { score: true, axes: true, createdAt: true },
  });
  console.log(`total=${rows.length}`);
  for (const r of rows) {
    console.log(
      `  score=${r.score} ${r.axes ? "v2(axes)" : "v1(null)"} at=${r.createdAt.toISOString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
