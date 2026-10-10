--liquibase formatted sql

--changeset razzolim:009-add-last-login-at-to-user
ALTER TABLE "user" ADD COLUMN "last_login_at" TIMESTAMP(3);
--rollback ALTER TABLE "user" DROP COLUMN "last_login_at";
