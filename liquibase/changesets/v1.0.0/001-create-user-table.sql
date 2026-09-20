--liquibase formatted sql

--changeset razzolim:001-create-user-table
CREATE TABLE "user" (
    "id" SERIAL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'reader',
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");
--rollback DROP INDEX "user_username_key"; DROP TABLE "user";
