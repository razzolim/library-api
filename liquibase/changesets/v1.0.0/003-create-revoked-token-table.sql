--liquibase formatted sql

--changeset razzolim:003-create-revoked-token-table
CREATE TABLE "revoked_token" (
    "id" SERIAL PRIMARY KEY,
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "revoked_token_jti_key" ON "revoked_token"("jti");
--rollback DROP INDEX "revoked_token_jti_key"; DROP TABLE "revoked_token";
