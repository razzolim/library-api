--liquibase formatted sql

--changeset razzolim:010-create-reading-progress-table
CREATE TABLE "reading_progress" (
    "user_id" INTEGER NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "book_id" INTEGER NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
    "page" INTEGER NOT NULL,
    "total_pages" INTEGER NOT NULL,
    "percent" NUMERIC(5,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    "first_opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("user_id", "book_id")
);
CREATE INDEX "reading_progress_user_updated_idx" ON "reading_progress"("user_id", "updated_at" DESC);
--rollback DROP TABLE "reading_progress";
