--liquibase formatted sql

--changeset razzolim:006-add-sessions-valid-after-to-user
ALTER TABLE "user" ADD COLUMN "sessions_valid_after" TIMESTAMPTZ;
--rollback ALTER TABLE "user" DROP COLUMN "sessions_valid_after";
