--liquibase formatted sql

--changeset razzolim:012-add-reader-preferences-to-user
ALTER TABLE "user" ADD COLUMN "reader_preferences" JSONB;
--rollback ALTER TABLE "user" DROP COLUMN "reader_preferences";
