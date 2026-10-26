-- WebNovel: 15 application tables, 6 enums, indexes, foreign keys and CHECK constraints.
-- Generated from all four existing migrations; no account/book data or secrets.
-- FOR A NEW EMPTY DATABASE / public SCHEMA ONLY. Do not run on existing webnovel_db.
-- Prefer Prisma Migrate Deploy for application deployment and migration tracking.
BEGIN;
-- Migration: 20261017154658_init
-- Apply all schema changes atomically.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "story_type" AS ENUM ('NOVEL', 'COMIC');

-- CreateEnum
CREATE TYPE "story_status" AS ENUM ('ONGOING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "publish_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "comment_status" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'USER',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "story_type" NOT NULL,
    "author_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cover_url" TEXT NOT NULL,
    "status" "story_status" NOT NULL DEFAULT 'ONGOING',
    "publish_status" "publish_status" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_genres" (
    "story_id" UUID NOT NULL,
    "genre_id" UUID NOT NULL,

    CONSTRAINT "story_genres_pkey" PRIMARY KEY ("story_id","genre_id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "chapter_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "publish_status" "publish_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_pages" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "image_url" TEXT NOT NULL,
    "storage_public_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "text_offset" INTEGER,
    "page_number" INTEGER,
    "scroll_offset" INTEGER,
    "progress_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "review_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "parent_id" UUID,
    "content" TEXT NOT NULL,
    "status" "comment_status" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stories_slug_key" ON "stories"("slug");

-- CreateIndex
CREATE INDEX "stories_created_by_idx" ON "stories"("created_by");

-- CreateIndex
CREATE INDEX "stories_publish_status_created_at_idx" ON "stories"("publish_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stories_type_publish_status_status_updated_at_idx" ON "stories"("type", "publish_status", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "genres_name_key" ON "genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "genres_slug_key" ON "genres"("slug");

-- CreateIndex
CREATE INDEX "story_genres_genre_id_story_id_idx" ON "story_genres"("genre_id", "story_id");

-- CreateIndex
CREATE INDEX "chapters_story_id_publish_status_chapter_number_idx" ON "chapters"("story_id", "publish_status", "chapter_number");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_story_id_chapter_number_key" ON "chapters"("story_id", "chapter_number");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_id_story_id_key" ON "chapters"("id", "story_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_pages_chapter_id_page_number_key" ON "chapter_pages"("chapter_id", "page_number");

-- CreateIndex
CREATE INDEX "favorites_story_id_idx" ON "favorites"("story_id");

-- CreateIndex
CREATE INDEX "favorites_user_id_created_at_idx" ON "favorites"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_story_id_key" ON "favorites"("user_id", "story_id");

-- CreateIndex
CREATE INDEX "reading_progress_story_id_idx" ON "reading_progress"("story_id");

-- CreateIndex
CREATE INDEX "reading_progress_chapter_id_story_id_idx" ON "reading_progress"("chapter_id", "story_id");

-- CreateIndex
CREATE INDEX "reading_progress_user_id_updated_at_idx" ON "reading_progress"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reading_progress_user_id_story_id_key" ON "reading_progress"("user_id", "story_id");

-- CreateIndex
CREATE INDEX "reading_history_user_id_read_at_idx" ON "reading_history"("user_id", "read_at" DESC);

-- CreateIndex
CREATE INDEX "reading_history_user_id_story_id_read_at_idx" ON "reading_history"("user_id", "story_id", "read_at" DESC);

-- CreateIndex
CREATE INDEX "reading_history_story_id_idx" ON "reading_history"("story_id");

-- CreateIndex
CREATE INDEX "reading_history_chapter_id_story_id_idx" ON "reading_history"("chapter_id", "story_id");

-- CreateIndex
CREATE INDEX "ratings_story_id_created_at_idx" ON "ratings"("story_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ratings_user_id_story_id_key" ON "ratings"("user_id", "story_id");

-- CreateIndex
CREATE INDEX "comments_parent_id_story_id_idx" ON "comments"("parent_id", "story_id");

-- CreateIndex
CREATE INDEX "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE INDEX "comments_story_id_status_created_at_idx" ON "comments"("story_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "comments_id_story_id_key" ON "comments"("id", "story_id");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "story_genres" ADD CONSTRAINT "story_genres_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "story_genres" ADD CONSTRAINT "story_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chapter_pages" ADD CONSTRAINT "chapter_pages_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_chapter_id_story_id_fkey" FOREIGN KEY ("chapter_id", "story_id") REFERENCES "chapters"("id", "story_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reading_history" ADD CONSTRAINT "reading_history_chapter_id_story_id_fkey" FOREIGN KEY ("chapter_id", "story_id") REFERENCES "chapters"("id", "story_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_story_id_fkey" FOREIGN KEY ("parent_id", "story_id") REFERENCES "comments"("id", "story_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Business rules not expressible as Prisma Schema CHECK constraints.
ALTER TABLE "ratings"
    ADD CONSTRAINT "ratings_score_range_check"
    CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "reading_progress"
    ADD CONSTRAINT "reading_progress_percent_range_check"
    CHECK ("progress_percent" BETWEEN 0 AND 100),
    ADD CONSTRAINT "reading_progress_text_offset_nonnegative_check"
    CHECK ("text_offset" IS NULL OR "text_offset" >= 0),
    ADD CONSTRAINT "reading_progress_scroll_offset_nonnegative_check"
    CHECK ("scroll_offset" IS NULL OR "scroll_offset" >= 0),
    ADD CONSTRAINT "reading_progress_page_number_positive_check"
    CHECK ("page_number" IS NULL OR "page_number" > 0);

ALTER TABLE "chapters"
    ADD CONSTRAINT "chapters_chapter_number_positive_check"
    CHECK ("chapter_number" > 0);

ALTER TABLE "chapter_pages"
    ADD CONSTRAINT "chapter_pages_page_number_positive_check"
    CHECK ("page_number" > 0);

-- Migration: 20261017160606_auth_sessions
-- Additive migration only; existing business tables and rows are preserved.

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Migration: 20261024000000_bookmarks
-- Additive Bookmark only. Existing rows and tables are not modified.

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "text_offset" INTEGER,
    "page_number" INTEGER,
    "chapter_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookmarks_user_id_created_at_id_idx" ON "bookmarks"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bookmarks_chapter_id_story_id_idx" ON "bookmarks"("chapter_id", "story_id");

-- CreateIndex
CREATE INDEX "bookmarks_story_id_idx" ON "bookmarks"("story_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_user_id_chapter_id_key" ON "bookmarks"("user_id", "chapter_id");

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_chapter_id_story_id_fkey" FOREIGN KEY ("chapter_id", "story_id") REFERENCES "chapters"("id", "story_id") ON DELETE RESTRICT ON UPDATE NO ACTION;


ALTER TABLE "bookmarks"
 ADD CONSTRAINT "bookmarks_text_offset_nonnegative_check" CHECK ("text_offset" IS NULL OR "text_offset" >= 0),
 ADD CONSTRAINT "bookmarks_page_number_positive_check" CHECK ("page_number" IS NULL OR "page_number" > 0),
 ADD CONSTRAINT "bookmarks_position_type_check" CHECK (("text_offset" IS NOT NULL AND "page_number" IS NULL) OR ("text_offset" IS NULL AND "page_number" IS NOT NULL));

-- Migration: 20261024010000_password_resets
-- Additive password recovery only; no existing rows or tables are changed.

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
