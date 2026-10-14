-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "idempotencyKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_idempotencyKey_key" ON "quote_requests"("idempotencyKey");

