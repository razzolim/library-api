--liquibase formatted sql

--changeset razzolim:001-create-book-table
CREATE TABLE "book" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "genre" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "isbn" TEXT NOT NULL,
    "cover_color" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pdf_url" TEXT
);
--rollback DROP TABLE "book";

--changeset razzolim:002-create-book-isbn-unique-index
CREATE UNIQUE INDEX "book_isbn_key" ON "book"("isbn");
--rollback DROP INDEX "book_isbn_key";
