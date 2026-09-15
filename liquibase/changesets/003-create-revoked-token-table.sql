--liquibase formatted sql

--changeset razzolim:001-create-revoked-token-table
CREATE TABLE "revoked_token" (
    "id" SERIAL PRIMARY KEY,
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--rollback DROP TABLE "revoked_token";

--changeset razzolim:002-create-revoked-token-jti-unique-index
CREATE UNIQUE INDEX "revoked_token_jti_key" ON "revoked_token"("jti");
--rollback DROP INDEX "revoked_token_jti_key";
