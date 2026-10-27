-- CreateEnum
CREATE TYPE "StewardEventKind" AS ENUM ('USER_MESSAGE', 'AGENT_MESSAGE', 'TOOL_STEP', 'PROPOSAL', 'SYSTEM_UPDATE');

-- CreateTable
CREATE TABLE "steward_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "active_guide_id" TEXT,
    "active_request_id" TEXT,
    "stage" VARCHAR(40) NOT NULL DEFAULT 'GOAL',
    "last_seen" JSONB NOT NULL DEFAULT '{}',
    "turn_started_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "steward_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steward_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" "StewardEventKind" NOT NULL,
    "tool" VARCHAR(60),
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steward_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steward_sessions_user_id_idx" ON "steward_sessions"("user_id");

-- CreateIndex
CREATE INDEX "steward_sessions_goal_id_idx" ON "steward_sessions"("goal_id");

-- CreateIndex
CREATE INDEX "steward_events_session_id_created_at_idx" ON "steward_events"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "steward_sessions" ADD CONSTRAINT "steward_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steward_sessions" ADD CONSTRAINT "steward_sessions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "learner_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steward_events" ADD CONSTRAINT "steward_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "steward_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
