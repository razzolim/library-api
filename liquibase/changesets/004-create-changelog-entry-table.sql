--liquibase formatted sql

--changeset razzolim:001-create-changelog-entry-table
CREATE TABLE "changelog_entry" (
    "id" SERIAL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL
);
--rollback DROP TABLE "changelog_entry";

--changeset razzolim:002-create-changelog-entry-version-unique-index
CREATE UNIQUE INDEX "changelog_entry_version_key" ON "changelog_entry"("version");
--rollback DROP INDEX "changelog_entry_version_key";
