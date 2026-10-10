--liquibase formatted sql

--changeset razzolim:011-create-bookmark-table
CREATE TABLE "bookmark" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "book_id" INTEGER NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
    "page" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "bookmark_user_id_book_id_page_key" ON "bookmark"("user_id", "book_id", "page");
--rollback DROP TABLE "bookmark";
