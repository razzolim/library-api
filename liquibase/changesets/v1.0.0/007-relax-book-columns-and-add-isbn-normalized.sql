--liquibase formatted sql

--changeset razzolim:007-relax-book-columns-and-add-isbn-normalized
ALTER TABLE "book" ALTER COLUMN "year" DROP NOT NULL;
ALTER TABLE "book" ALTER COLUMN "genre" DROP NOT NULL;
ALTER TABLE "book" ALTER COLUMN "summary" DROP NOT NULL;
ALTER TABLE "book" ALTER COLUMN "cover_color" SET DEFAULT '#4a5568';
ALTER TABLE "book" ALTER COLUMN "isbn" DROP NOT NULL;
ALTER TABLE "book" ADD COLUMN "isbn_normalized" TEXT;
UPDATE "book" SET "isbn_normalized" = UPPER(REPLACE("isbn", '-', ''));
DROP INDEX "book_isbn_key";
CREATE UNIQUE INDEX "book_isbn_normalized_key" ON "book"("isbn_normalized");
--rollback DROP INDEX "book_isbn_normalized_key"; CREATE UNIQUE INDEX "book_isbn_key" ON "book"("isbn"); ALTER TABLE "book" DROP COLUMN "isbn_normalized"; ALTER TABLE "book" ALTER COLUMN "cover_color" DROP DEFAULT;
