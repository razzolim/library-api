--liquibase formatted sql

--changeset razzolim:008-add-email-to-user
ALTER TABLE "user" ADD COLUMN "email" VARCHAR(255);
CREATE UNIQUE INDEX "user_email_lower_key" ON "user"(LOWER("email"));
--rollback DROP INDEX "user_email_lower_key"; ALTER TABLE "user" DROP COLUMN "email";
