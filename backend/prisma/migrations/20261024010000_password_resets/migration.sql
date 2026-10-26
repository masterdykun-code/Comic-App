-- Additive password recovery only; no existing rows or tables are changed.
BEGIN;
CREATE TABLE "password_resets" (
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "password_resets_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
    CONSTRAINT "password_resets_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "password_resets_expires_at_idx" ON "password_resets"("expires_at");
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
COMMIT;
