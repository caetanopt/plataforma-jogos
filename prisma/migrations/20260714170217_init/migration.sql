-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('ORG_ADMIN', 'EDITOR', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'SVG');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('MEMORY', 'WHEEL', 'QUIZ');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ParticipationLimitType" AS ENUM ('UNLIMITED', 'ONE_TOTAL', 'ONE_PER_DAY', 'ONE_PER_HOUR', 'CUSTOM_MAX');

-- CreateEnum
CREATE TYPE "DedupStrategy" AS ENUM ('EMAIL', 'PHONE', 'COOKIE', 'SESSION', 'IP', 'CODE', 'FIELD_COMBINATION');

-- CreateEnum
CREATE TYPE "ScreenKind" AS ENUM ('INTERMEDIATE_BEFORE', 'INTERMEDIATE_AFTER');

-- CreateEnum
CREATE TYPE "LeadFormPosition" AS ENUM ('BEFORE_GAME', 'AFTER_GAME', 'BEFORE_RESULT', 'BEFORE_PRIZE', 'NONE');

-- CreateEnum
CREATE TYPE "LeadFieldType" AS ENUM ('FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'PHONE', 'BIRTH_DATE', 'POSTAL_CODE', 'CITY', 'COUNTRY', 'COMPANY', 'JOB_TITLE', 'CUSTOMER_NUMBER', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_TEXT', 'LONG_TEXT', 'DROPDOWN', 'DATE', 'CHECKBOX', 'HIDDEN', 'CONSENT', 'TERMS_ACCEPTANCE');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MemoryPairKind" AS ENUM ('SAME_IMAGE', 'DIFFERENT_IMAGE_MATCH', 'IMAGE_TEXT', 'TEXT_TEXT');

-- CreateEnum
CREATE TYPE "WheelSegmentOutcome" AS ENUM ('WIN', 'NO_WIN');

-- CreateEnum
CREATE TYPE "PrizeCodeStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'IMAGE_CHOICE');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('CAMPAIGN_VIEWED', 'START_CLICKED', 'LEAD_FORM_VIEWED', 'LEAD_FORM_SUBMITTED', 'GAME_STARTED', 'GAME_COMPLETED', 'GAME_ABANDONED', 'RESULT_VIEWED', 'CTA_CLICKED', 'PARTICIPATION_BLOCKED', 'PRIZE_AWARDED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'CREATE', 'UPDATE', 'PUBLISH', 'PAUSE', 'ARCHIVE', 'DELETE', 'EXPORT', 'PERMISSION_CHANGE', 'ODDS_CHANGE', 'STOCK_CHANGE', 'CODE_CHANGE', 'PRIVACY_OPERATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "privacyContactEmail" TEXT,
    "dataRetentionDays" INTEGER,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTheme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBrandKit" BOOLEAN NOT NULL DEFAULT false,
    "sourceBrandKitId" TEXT,
    "logoMediaId" TEXT,
    "faviconMediaId" TEXT,
    "backgroundImageMediaId" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#002E5D',
    "secondaryColor" TEXT NOT NULL DEFAULT '#00AEEF',
    "backgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "textColor" TEXT NOT NULL DEFAULT '#2E3A46',
    "buttonColor" TEXT NOT NULL DEFAULT '#00AEEF',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "fontFamily" TEXT NOT NULL DEFAULT 'Montserrat',
    "borderRadiusPx" INTEGER NOT NULL DEFAULT 8,
    "shadowEnabled" BOOLEAN NOT NULL DEFAULT true,
    "headerConfig" JSONB,
    "footerConfig" JSONB,
    "legalLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "internalName" TEXT NOT NULL,
    "publicTitle" TEXT,
    "internalReference" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT NOT NULL,
    "description" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "slug" TEXT NOT NULL,
    "themeId" TEXT,
    "startTitle" TEXT,
    "startSubtitle" TEXT,
    "startIntroText" TEXT,
    "startMediaId" TEXT,
    "startLogoMediaId" TEXT,
    "startButtonLabel" TEXT,
    "startPrizeInfo" TEXT,
    "countdownEnabled" BOOLEAN NOT NULL DEFAULT false,
    "regulationText" TEXT,
    "legalText" TEXT,
    "participationLimitType" "ParticipationLimitType" NOT NULL DEFAULT 'UNLIMITED',
    "participationCustomMax" INTEGER,
    "dedupStrategies" "DedupStrategy"[] DEFAULT ARRAY[]::"DedupStrategy"[],
    "dedupFieldCombination" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minAge" INTEGER,
    "scheduleStartAt" TIMESTAMP(3),
    "scheduleEndAt" TIMESTAMP(3),
    "scheduleBeforeMessage" TEXT,
    "scheduleAfterMessage" TEXT,
    "scheduleRedirectUrl" TEXT,
    "finalTitle" TEXT,
    "finalMessage" TEXT,
    "finalMediaId" TEXT,
    "finalCtaLabel" TEXT,
    "finalCtaUrl" TEXT,
    "finalAllowReplay" BOOLEAN NOT NULL DEFAULT false,
    "finalAllowShare" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignScreen" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "ScreenKind" NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "mediaId" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "continueButtonLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVersion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "campaignVersionId" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "qrPngMediaId" TEXT,
    "qrSvgMediaId" TEXT,
    "embedHeightPx" INTEGER NOT NULL DEFAULT 720,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadForm" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" "LeadFormPosition" NOT NULL DEFAULT 'BEFORE_GAME',
    "honeypotEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFormField" (
    "id" TEXT NOT NULL,
    "leadFormId" TEXT NOT NULL,
    "type" "LeadFieldType" NOT NULL,
    "internalKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "placeholder" TEXT,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "validationRegex" TEXT,
    "defaultValue" TEXT,
    "options" JSONB,
    "exportMapping" TEXT,

    CONSTRAINT "LeadFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentDefinition" (
    "id" TEXT NOT NULL,
    "leadFormId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isMarketing" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ConsentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "cookieId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignVersionId" TEXT NOT NULL,
    "participantId" TEXT,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'STARTED',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "leadFormResponse" JSONB,
    "resultSummary" JSONB,
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "sessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "consentDefinitionId" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "text" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryGameConfig" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "columns" INTEGER NOT NULL DEFAULT 4,
    "randomizeOrder" BOOLEAN NOT NULL DEFAULT true,
    "cardAspectRatio" TEXT NOT NULL DEFAULT '1/1',
    "cardGapPx" INTEGER NOT NULL DEFAULT 8,
    "timeLimitSeconds" INTEGER,
    "maxAttempts" INTEGER,
    "pointsPerPair" INTEGER NOT NULL DEFAULT 10,
    "penaltyPerMistake" INTEGER NOT NULL DEFAULT 0,
    "speedBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "previewSeconds" INTEGER,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rankingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rankingMaxEntries" INTEGER,
    "rankingAnonymize" BOOLEAN NOT NULL DEFAULT false,
    "cardBackMediaId" TEXT,

    CONSTRAINT "MemoryGameConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCardPair" (
    "id" TEXT NOT NULL,
    "memoryGameConfigId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "MemoryPairKind" NOT NULL,
    "cardAMediaId" TEXT,
    "cardAText" TEXT,
    "cardAAltText" TEXT,
    "cardBMediaId" TEXT,
    "cardBText" TEXT,
    "cardBAltText" TEXT,

    CONSTRAINT "MemoryCardPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryResult" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "timeSeconds" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "pairsFound" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,

    CONSTRAINT "MemoryResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelConfig" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "WheelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelSegment" (
    "id" TEXT NOT NULL,
    "wheelConfigId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "imageMediaId" TEXT,
    "outcome" "WheelSegmentOutcome" NOT NULL,
    "prizeId" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "totalQuantity" INTEGER,
    "remainingQuantity" INTEGER,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "message" TEXT,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WheelSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "description" TEXT,
    "imageMediaId" TEXT,
    "totalQuantity" INTEGER,
    "awardedQuantity" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "instructions" TEXT,
    "terms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeCode" (
    "id" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PrizeCodeStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrizeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeAward" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "wheelSegmentId" TEXT,
    "prizeCodeId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrizeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizConfig" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "questionsPerParticipation" INTEGER,
    "randomizeQuestionOrder" BOOLEAN NOT NULL DEFAULT false,
    "randomizeAnswerOrder" BOOLEAN NOT NULL DEFAULT false,
    "totalTimeLimitSeconds" INTEGER,
    "perQuestionTimeLimitSeconds" INTEGER,
    "penaltyPerWrong" INTEGER NOT NULL DEFAULT 0,
    "speedBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowGoBack" BOOLEAN NOT NULL DEFAULT true,
    "showProgress" BOOLEAN NOT NULL DEFAULT true,
    "showCorrectAnswer" BOOLEAN NOT NULL DEFAULT true,
    "showExplanation" BOOLEAN NOT NULL DEFAULT true,
    "minPassPercentage" INTEGER,
    "maxAttempts" INTEGER,

    CONSTRAINT "QuizConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "quizConfigId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "title" TEXT NOT NULL,
    "supportText" TEXT,
    "imageMediaId" TEXT,
    "points" INTEGER NOT NULL DEFAULT 10,
    "timeLimitSeconds" INTEGER,
    "explanation" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "immediateFeedback" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT,
    "imageMediaId" TEXT,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizResultProfile" (
    "id" TEXT NOT NULL,
    "quizConfigId" TEXT NOT NULL,
    "minPercentage" INTEGER NOT NULL,
    "maxPercentage" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageMediaId" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,

    CONSTRAINT "QuizResultProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizResponse" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN,
    "resultProfileId" TEXT,
    "timeSeconds" INTEGER NOT NULL,

    CONSTRAINT "QuizResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "result" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_token_key" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_organizationId_slug_key" ON "Workspace"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Folder_workspaceId_idx" ON "Folder"("workspaceId");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_idx" ON "MediaAsset"("organizationId");

-- CreateIndex
CREATE INDEX "CampaignTheme_organizationId_isBrandKit_idx" ON "CampaignTheme"("organizationId", "isBrandKit");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_themeId_key" ON "Campaign"("themeId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_workspaceId_status_idx" ON "Campaign"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "Campaign_folderId_idx" ON "Campaign"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignScreen_campaignId_kind_key" ON "CampaignScreen"("campaignId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_versionNumber_key" ON "CampaignVersion"("campaignId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_campaignVersionId_key" ON "Publication"("campaignVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadForm_campaignId_key" ON "LeadForm"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFormField_leadFormId_internalKey_key" ON "LeadFormField"("leadFormId", "internalKey");

-- CreateIndex
CREATE INDEX "ConsentDefinition_leadFormId_idx" ON "ConsentDefinition"("leadFormId");

-- CreateIndex
CREATE INDEX "Participant_organizationId_email_idx" ON "Participant"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Participant_organizationId_phone_idx" ON "Participant"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_idempotencyKey_key" ON "Participation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Participation_campaignId_status_createdAt_idx" ON "Participation"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Participation_campaignId_participantId_idx" ON "Participation"("campaignId", "participantId");

-- CreateIndex
CREATE INDEX "ConsentRecord_participationId_idx" ON "ConsentRecord"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_participationId_key" ON "GameSession"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryGameConfig_campaignId_key" ON "MemoryGameConfig"("campaignId");

-- CreateIndex
CREATE INDEX "MemoryCardPair_memoryGameConfigId_idx" ON "MemoryCardPair"("memoryGameConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryResult_participationId_key" ON "MemoryResult"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "WheelConfig_campaignId_key" ON "WheelConfig"("campaignId");

-- CreateIndex
CREATE INDEX "WheelSegment_wheelConfigId_idx" ON "WheelSegment"("wheelConfigId");

-- CreateIndex
CREATE INDEX "Prize_campaignId_idx" ON "Prize"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeCode_prizeId_code_key" ON "PrizeCode"("prizeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeAward_participationId_key" ON "PrizeAward"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeAward_prizeCodeId_key" ON "PrizeAward"("prizeCodeId");

-- CreateIndex
CREATE INDEX "PrizeAward_prizeId_idx" ON "PrizeAward"("prizeId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizConfig_campaignId_key" ON "QuizConfig"("campaignId");

-- CreateIndex
CREATE INDEX "QuizQuestion_quizConfigId_idx" ON "QuizQuestion"("quizConfigId");

-- CreateIndex
CREATE INDEX "QuizAnswer_questionId_idx" ON "QuizAnswer"("questionId");

-- CreateIndex
CREATE INDEX "QuizResultProfile_quizConfigId_idx" ON "QuizResultProfile"("quizConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizResponse_participationId_key" ON "QuizResponse"("participationId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_campaignId_type_occurredAt_idx" ON "AnalyticsEvent"("campaignId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTheme" ADD CONSTRAINT "CampaignTheme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "CampaignTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScreen" ADD CONSTRAINT "CampaignScreen_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_campaignVersionId_fkey" FOREIGN KEY ("campaignVersionId") REFERENCES "CampaignVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFormField" ADD CONSTRAINT "LeadFormField_leadFormId_fkey" FOREIGN KEY ("leadFormId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentDefinition" ADD CONSTRAINT "ConsentDefinition_leadFormId_fkey" FOREIGN KEY ("leadFormId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_campaignVersionId_fkey" FOREIGN KEY ("campaignVersionId") REFERENCES "CampaignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_consentDefinitionId_fkey" FOREIGN KEY ("consentDefinitionId") REFERENCES "ConsentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryGameConfig" ADD CONSTRAINT "MemoryGameConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCardPair" ADD CONSTRAINT "MemoryCardPair_memoryGameConfigId_fkey" FOREIGN KEY ("memoryGameConfigId") REFERENCES "MemoryGameConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryResult" ADD CONSTRAINT "MemoryResult_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelConfig" ADD CONSTRAINT "WheelConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelSegment" ADD CONSTRAINT "WheelSegment_wheelConfigId_fkey" FOREIGN KEY ("wheelConfigId") REFERENCES "WheelConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelSegment" ADD CONSTRAINT "WheelSegment_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeCode" ADD CONSTRAINT "PrizeCode_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_wheelSegmentId_fkey" FOREIGN KEY ("wheelSegmentId") REFERENCES "WheelSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_prizeCodeId_fkey" FOREIGN KEY ("prizeCodeId") REFERENCES "PrizeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizConfig" ADD CONSTRAINT "QuizConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizConfigId_fkey" FOREIGN KEY ("quizConfigId") REFERENCES "QuizConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResultProfile" ADD CONSTRAINT "QuizResultProfile_quizConfigId_fkey" FOREIGN KEY ("quizConfigId") REFERENCES "QuizConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResponse" ADD CONSTRAINT "QuizResponse_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
