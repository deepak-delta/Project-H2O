import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(connectionString: string, options: { maxConnections?: number } = {}): Db {
  const adapter = new PrismaPg({ connectionString, max: options.maxConnections ?? 5 });
  return new PrismaClient({ adapter });
}
