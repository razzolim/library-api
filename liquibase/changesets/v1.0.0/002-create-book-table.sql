--liquibase formatted sql

--changeset razzolim:002-create-book-table
CREATE TABLE "book" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "year" INTEGER,
    "genre" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "isbn" TEXT,
    "isbn_normalized" TEXT,
    "cover_color" TEXT NOT NULL DEFAULT '#4a5568',
    "summary" TEXT,
    "pdf_url" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "book_isbn_normalized_key" ON "book"("isbn_normalized");
--rollback DROP INDEX "book_isbn_normalized_key"; DROP TABLE "book";
