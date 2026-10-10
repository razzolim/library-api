--liquibase formatted sql

--changeset razzolim:014-create-feature-flag-table
CREATE TABLE "feature_flag" (
    "key" VARCHAR(64) PRIMARY KEY,
    "description" VARCHAR(255) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_by" TEXT
);
--rollback DROP TABLE "feature_flag";
