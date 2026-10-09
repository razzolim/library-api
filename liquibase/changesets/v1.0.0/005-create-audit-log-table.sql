--liquibase formatted sql

--changeset razzolim:005-create-audit-log-table
CREATE TABLE "audit_log" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "actor_user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--rollback DROP TABLE "audit_log";
