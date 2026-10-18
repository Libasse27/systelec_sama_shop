-- CreateIndex
CREATE INDEX "audit_logs_action_entityId_createdAt_idx" ON "audit_logs"("action", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_ip_createdAt_idx" ON "audit_logs"("action", "ip", "createdAt");
