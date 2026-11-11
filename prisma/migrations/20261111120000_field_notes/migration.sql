-- CreateEnum
CREATE TYPE "FieldNoteSource" AS ENUM ('GUIDE', 'RESPONSE');

-- CreateEnum
CREATE TYPE "FieldNoteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');

-- AlterEnum
ALTER TYPE "ContributorStatus" ADD VALUE 'EARNER';

-- CreateTable
CREATE TABLE "field_notes" (
    "id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "payee_contributor_id" TEXT,
    "source" "FieldNoteSource" NOT NULL,
    "source_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "FieldNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "hidden_reason" VARCHAR(300),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "field_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_notes_guide_id_status_idx" ON "field_notes"("guide_id", "status");

-- CreateIndex
CREATE INDEX "field_notes_payee_contributor_id_idx" ON "field_notes"("payee_contributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_notes_author_user_id_guide_id_key" ON "field_notes"("author_user_id", "guide_id");

-- AddForeignKey
ALTER TABLE "field_notes" ADD CONSTRAINT "field_notes_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_notes" ADD CONSTRAINT "field_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_notes" ADD CONSTRAINT "field_notes_payee_contributor_id_fkey" FOREIGN KEY ("payee_contributor_id") REFERENCES "contributor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

