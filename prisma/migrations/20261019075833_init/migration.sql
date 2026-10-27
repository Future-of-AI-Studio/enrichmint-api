-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ContributorStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DRAFTED');

-- CreateEnum
CREATE TYPE "GuideStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecommendationSlot" AS ENUM ('STANDARD', 'NEW_CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('GUIDE', 'REQUEST');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'APPROVED', 'CAPTURE_PENDING', 'COMPLETED', 'DENIED', 'FAILED', 'REFUNDED', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED_REFUND', 'REVOKED_ADMIN');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('GROSS_SALES', 'PLATFORM_COMMISSION', 'PROCESSING_FEE', 'CONTRIBUTOR_PAYABLE', 'REFUNDS', 'PAYOUTS');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PENDING', 'SUCCESS', 'FAILED', 'UNCLAIMED', 'RETURNED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'PAYMENT_EXPIRED', 'PAID', 'OVERDUE', 'DELIVERED', 'CLOSED', 'DISPUTED', 'REFUNDED', 'RESOLVED_REFUNDED', 'RESOLVED_UPHELD');

-- CreateEnum
CREATE TYPE "TransitionActor" AS ENUM ('LEARNER', 'CONTRIBUTOR', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "FeedbackTarget" AS ENUM ('GUIDE', 'RESPONSE');

-- CreateEnum
CREATE TYPE "FeedbackPhase" AS ENUM ('IMMEDIATE', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'WARN', 'DENY');

-- CreateEnum
CREATE TYPE "PolicySource" AS ENUM ('LOCAL', 'HCAI', 'HCAI_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "sessions_revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributor_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "headline" VARCHAR(160) NOT NULL,
    "background" TEXT NOT NULL,
    "status" "ContributorStatus" NOT NULL DEFAULT 'PENDING',
    "payout_email" VARCHAR(255),
    "response_price_cents" INTEGER,
    "accepting_requests" BOOLEAN NOT NULL DEFAULT false,
    "acceptance_window_h" INTEGER NOT NULL DEFAULT 48,
    "delivery_h" INTEGER NOT NULL DEFAULT 72,
    "boundaries" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contributor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers" JSONB NOT NULL DEFAULT '[]',
    "guide_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guides" (
    "id" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "GuideStatus" NOT NULL DEFAULT 'DRAFT',
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_assist_allowed" BOOLEAN NOT NULL DEFAULT true,
    "current_version_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_versions" (
    "id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "preview" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "claim_label" VARCHAR(40) NOT NULL DEFAULT 'SELF_REPORTED',
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewer_id" TEXT,
    "review_note" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_permission_changes" (
    "id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "field" VARCHAR(60) NOT NULL,
    "old_value" VARCHAR(200) NOT NULL,
    "new_value" VARCHAR(200) NOT NULL,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_permission_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_gaps" (
    "id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "budget_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learner_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "fit_notes" TEXT,
    "slot" "RecommendationSlot" NOT NULL DEFAULT 'STANDARD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "kind" "OrderKind" NOT NULL,
    "guide_id" TEXT,
    "request_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "commission_bps" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "idempotency_key" TEXT NOT NULL,
    "paypal_order_id" TEXT,
    "paypal_capture_id" TEXT,
    "paypal_fee_cents" INTEGER,
    "failure_reason" VARCHAR(200),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "paypal_event_id" TEXT NOT NULL,
    "type" VARCHAR(120) NOT NULL,
    "resource_id" VARCHAR(120),
    "verified" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" VARCHAR(200),
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "purchased_version_id" TEXT NOT NULL,
    "ai_questions_limit" INTEGER NOT NULL,
    "ai_questions_used" INTEGER NOT NULL DEFAULT 0,
    "ai_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "contributor_id" TEXT,
    "order_id" TEXT,
    "refund_id" TEXT,
    "payout_id" TEXT,
    "account" "LedgerAccount" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "memo" VARCHAR(200) NOT NULL,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "receiver_email" VARCHAR(255) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "paypal_batch_id" TEXT,
    "paypal_item_id" TEXT,
    "failure_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "paypal_refund_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_requests" (
    "id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "contributor_id" TEXT NOT NULL,
    "guide_id" TEXT,
    "goal_id" TEXT,
    "question" TEXT NOT NULL,
    "desired_response" TEXT NOT NULL,
    "context_items" JSONB NOT NULL DEFAULT '[]',
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "delivery_h" INTEGER NOT NULL,
    "acceptance_h" INTEGER NOT NULL,
    "state" "RequestState" NOT NULL DEFAULT 'DRAFT',
    "decline_reason" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "accept_by" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "pay_by" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "deliver_by" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "personal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_transitions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "from_state" "RequestState" NOT NULL,
    "to_state" "RequestState" NOT NULL,
    "actor" "TransitionActor" NOT NULL,
    "actor_id" TEXT,
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_responses" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ai_use_allowed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "guide_id" TEXT,
    "request_id" TEXT,
    "role" VARCHAR(16) NOT NULL,
    "content" JSONB NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_type" "FeedbackTarget" NOT NULL,
    "target_id" TEXT NOT NULL,
    "phase" "FeedbackPhase" NOT NULL,
    "relevant" BOOLEAN,
    "next_step" BOOLEAN,
    "missing_or_misleading" TEXT,
    "tried" BOOLEAN,
    "outcome" TEXT,
    "useful_after" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decisions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "check" VARCHAR(80) NOT NULL,
    "subject_type" VARCHAR(40) NOT NULL,
    "subject_id" TEXT,
    "outcome" "PolicyOutcome" NOT NULL,
    "source" "PolicySource" NOT NULL,
    "plain_reason" TEXT NOT NULL,
    "user_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "subject_type" VARCHAR(40) NOT NULL,
    "subject_id" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_calls" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "purpose" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "prompt_version" VARCHAR(40) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "contributor_profiles_user_id_key" ON "contributor_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "interviews_guide_id_key" ON "interviews"("guide_id");

-- CreateIndex
CREATE INDEX "interviews_contributor_id_idx" ON "interviews"("contributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "guides_slug_key" ON "guides"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "guides_current_version_id_key" ON "guides"("current_version_id");

-- CreateIndex
CREATE INDEX "guides_contributor_id_idx" ON "guides"("contributor_id");

-- CreateIndex
CREATE INDEX "guides_category_id_idx" ON "guides"("category_id");

-- CreateIndex
CREATE INDEX "guides_status_idx" ON "guides"("status");

-- CreateIndex
CREATE INDEX "guide_versions_guide_id_idx" ON "guide_versions"("guide_id");

-- CreateIndex
CREATE INDEX "guide_versions_review_status_idx" ON "guide_versions"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "guide_versions_guide_id_number_key" ON "guide_versions"("guide_id", "number");

-- CreateIndex
CREATE INDEX "guide_permission_changes_guide_id_idx" ON "guide_permission_changes"("guide_id");

-- CreateIndex
CREATE INDEX "guide_gaps_guide_id_idx" ON "guide_gaps"("guide_id");

-- CreateIndex
CREATE INDEX "guide_gaps_user_id_idx" ON "guide_gaps"("user_id");

-- CreateIndex
CREATE INDEX "learner_goals_user_id_idx" ON "learner_goals"("user_id");

-- CreateIndex
CREATE INDEX "recommendations_goal_id_idx" ON "recommendations"("goal_id");

-- CreateIndex
CREATE INDEX "recommendations_guide_id_idx" ON "recommendations"("guide_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paypal_order_id_key" ON "orders"("paypal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paypal_capture_id_key" ON "orders"("paypal_capture_id");

-- CreateIndex
CREATE INDEX "orders_buyer_id_idx" ON "orders"("buyer_id");

-- CreateIndex
CREATE INDEX "orders_goal_id_idx" ON "orders"("goal_id");

-- CreateIndex
CREATE INDEX "orders_guide_id_idx" ON "orders"("guide_id");

-- CreateIndex
CREATE INDEX "orders_request_id_idx" ON "orders"("request_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_paypal_event_id_key" ON "webhook_events"("paypal_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_resource_id_idx" ON "webhook_events"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_order_id_key" ON "entitlements"("order_id");

-- CreateIndex
CREATE INDEX "entitlements_guide_id_idx" ON "entitlements"("guide_id");

-- CreateIndex
CREATE INDEX "entitlements_purchased_version_id_idx" ON "entitlements"("purchased_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_user_id_guide_id_key" ON "entitlements"("user_id", "guide_id");

-- CreateIndex
CREATE INDEX "ledger_entries_contributor_id_idx" ON "ledger_entries"("contributor_id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_refund_id_idx" ON "ledger_entries"("refund_id");

-- CreateIndex
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paypal_batch_id_key" ON "payouts"("paypal_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paypal_item_id_key" ON "payouts"("paypal_item_id");

-- CreateIndex
CREATE INDEX "payouts_contributor_id_idx" ON "payouts"("contributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_paypal_refund_id_key" ON "refunds"("paypal_refund_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "personal_requests_learner_id_idx" ON "personal_requests"("learner_id");

-- CreateIndex
CREATE INDEX "personal_requests_contributor_id_idx" ON "personal_requests"("contributor_id");

-- CreateIndex
CREATE INDEX "personal_requests_guide_id_idx" ON "personal_requests"("guide_id");

-- CreateIndex
CREATE INDEX "personal_requests_goal_id_idx" ON "personal_requests"("goal_id");

-- CreateIndex
CREATE INDEX "personal_requests_state_idx" ON "personal_requests"("state");

-- CreateIndex
CREATE INDEX "request_transitions_request_id_idx" ON "request_transitions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "request_responses_request_id_key" ON "request_responses"("request_id");

-- CreateIndex
CREATE INDEX "assistant_messages_user_id_idx" ON "assistant_messages"("user_id");

-- CreateIndex
CREATE INDEX "assistant_messages_guide_id_idx" ON "assistant_messages"("guide_id");

-- CreateIndex
CREATE INDEX "feedback_target_type_target_id_idx" ON "feedback"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_user_id_target_type_target_id_phase_key" ON "feedback"("user_id", "target_type", "target_id", "phase");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "policy_decisions_user_id_idx" ON "policy_decisions"("user_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_subject_type_subject_id_idx" ON "audit_events"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "model_calls_user_id_idx" ON "model_calls"("user_id");

-- CreateIndex
CREATE INDEX "model_calls_created_at_idx" ON "model_calls"("created_at");

-- AddForeignKey
ALTER TABLE "contributor_profiles" ADD CONSTRAINT "contributor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guides" ADD CONSTRAINT "guides_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guides" ADD CONSTRAINT "guides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guides" ADD CONSTRAINT "guides_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "guide_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_versions" ADD CONSTRAINT "guide_versions_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_permission_changes" ADD CONSTRAINT "guide_permission_changes_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_gaps" ADD CONSTRAINT "guide_gaps_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_goals" ADD CONSTRAINT "learner_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "learner_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "learner_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "personal_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_purchased_version_id_fkey" FOREIGN KEY ("purchased_version_id") REFERENCES "guide_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_requests" ADD CONSTRAINT "personal_requests_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_requests" ADD CONSTRAINT "personal_requests_contributor_id_fkey" FOREIGN KEY ("contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_requests" ADD CONSTRAINT "personal_requests_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_requests" ADD CONSTRAINT "personal_requests_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "learner_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_transitions" ADD CONSTRAINT "request_transitions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "personal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_responses" ADD CONSTRAINT "request_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "personal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
