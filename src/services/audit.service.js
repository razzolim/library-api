// Writes an admin-action record. Pass the transaction client as `db` so the entry commits (or
// rolls back) together with the change it describes. `metadata` must never contain passwords
// or tokens.
export function recordAudit(db, { actorUserId, action, targetType, targetId, ip, userAgent, metadata }) {
  return db.auditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId: String(targetId),
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      metadata: metadata ?? undefined,
    },
  });
}
