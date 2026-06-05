-- AlterTable
ALTER TABLE "users" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "occupation" TEXT;
