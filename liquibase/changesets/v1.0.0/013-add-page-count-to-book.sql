--liquibase formatted sql

--changeset razzolim:013-add-page-count-to-book
ALTER TABLE "book" ADD COLUMN "page_count" INTEGER;
--rollback ALTER TABLE "book" DROP COLUMN "page_count";
