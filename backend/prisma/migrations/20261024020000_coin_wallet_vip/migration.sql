BEGIN;

-- AlterTable
ALTER TABLE "chapters" ADD COLUMN     "coin_price" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "is_vip" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "coin_wallets" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "coin_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_unlocks" (
    "user_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "paid_coins" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_unlocks_pkey" PRIMARY KEY ("user_id","chapter_id")
);

-- CreateTable
CREATE TABLE "coin_daily_activities" (
    "user_id" UUID NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_daily_activities_pkey" PRIMARY KEY ("user_id","day","kind","target_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coin_transactions_event_key_key" ON "coin_transactions"("event_key");

-- CreateIndex
CREATE INDEX "coin_transactions_user_id_created_at_id_idx" ON "coin_transactions"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "chapter_unlocks_chapter_id_idx" ON "chapter_unlocks"("chapter_id");

-- AddForeignKey
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "coin_wallets"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_unlocks" ADD CONSTRAINT "chapter_unlocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_unlocks" ADD CONSTRAINT "chapter_unlocks_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_daily_activities" ADD CONSTRAINT "coin_daily_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integer bounds and fixed demo reward values are enforced independently of the API.
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_coin_price_check" CHECK ("coin_price" BETWEEN 1 AND 100000);
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_balance_check" CHECK ("balance" >= 0);
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_balance_check" CHECK ("balance_after" >= 0),
ADD CONSTRAINT "coin_transactions_amount_check" CHECK (
  ("kind" = 'CHECK_IN' AND "amount" = 10) OR
  ("kind" = 'READ_THREE' AND "amount" = 20) OR
  ("kind" = 'FAVORITE' AND "amount" = 5) OR
  ("kind" = 'UNLOCK' AND "amount" BETWEEN -100000 AND -1)
);
ALTER TABLE "chapter_unlocks" ADD CONSTRAINT "chapter_unlocks_paid_check" CHECK ("paid_coins" BETWEEN 1 AND 100000);
ALTER TABLE "coin_daily_activities" ADD CONSTRAINT "coin_daily_activities_kind_check" CHECK ("kind" IN ('READ', 'FAVORITE'));
COMMIT;
