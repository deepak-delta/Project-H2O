-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('STORE', 'HOME', 'INDIVIDUAL', 'OTHER');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "category" "ClientCategory" NOT NULL DEFAULT 'STORE',
ADD COLUMN     "categoryOther" TEXT;

