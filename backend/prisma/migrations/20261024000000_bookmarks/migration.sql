-- Additive Bookmark only. Existing rows and tables are not modified.
BEGIN;
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

COMMIT;
