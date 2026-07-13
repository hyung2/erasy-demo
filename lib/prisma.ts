// Prisma Client 싱글턴. Next dev의 HMR로 커넥션이 누적되지 않도록 globalThis에 캐시.
// 실제 DB 연결은 W2에서 DATABASE_URL 주입 후 활성. 스키마는 prisma/schema.prisma.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
