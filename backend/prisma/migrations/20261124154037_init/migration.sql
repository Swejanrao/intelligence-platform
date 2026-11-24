-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QuestionCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "topic" TEXT,
    "skill" TEXT,
    "difficulty" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "marks" REAL NOT NULL DEFAULT 1,
    "negativeMarks" REAL NOT NULL DEFAULT 0,
    "explanation" TEXT,
    "categoryId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "Question_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QuestionCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "scoreValue" REAL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "durationMinutes" INTEGER NOT NULL,
    "negativeMarking" BOOLEAN NOT NULL DEFAULT false,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AssessmentSection_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentBlueprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    CONSTRAINT "AssessmentBlueprint_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentBlueprint_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AssessmentSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentBlueprint_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QuestionCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "optionsSnapshot" TEXT NOT NULL DEFAULT '[]',
    "marksSnapshot" REAL NOT NULL,
    "negativeSnapshot" REAL NOT NULL DEFAULT 0,
    "metadataSnapshot" TEXT NOT NULL DEFAULT '{}',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttemptQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttemptQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AssessmentSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CandidateResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptQuestionId" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL DEFAULT '{}',
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CandidateResponse_attemptQuestionId_fkey" FOREIGN KEY ("attemptQuestionId") REFERENCES "AttemptQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoringDimension" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "QuestionDimensionMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "direction" TEXT NOT NULL DEFAULT 'POSITIVE',
    "reverseScored" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "QuestionDimensionMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionDimensionMapping_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "ScoringDimension" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "technicalScore" REAL NOT NULL DEFAULT 0,
    "maximumScore" REAL NOT NULL DEFAULT 0,
    "percentage" REAL NOT NULL DEFAULT 0,
    "sectionScoresJson" TEXT NOT NULL DEFAULT '[]',
    "dimensionScoresJson" TEXT NOT NULL DEFAULT '[]',
    "illustrativeNotice" TEXT NOT NULL DEFAULT 'Illustrative summary. Not a clinical or diagnostic result.',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssessmentResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionCategory_name_key" ON "QuestionCategory"("name");

-- CreateIndex
CREATE INDEX "Question_categoryId_difficulty_status_idx" ON "Question"("categoryId", "difficulty", "status");

-- CreateIndex
CREATE INDEX "Question_type_status_idx" ON "Question"("type", "status");

-- CreateIndex
CREATE INDEX "QuestionOption_questionId_position_idx" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE INDEX "Assessment_status_type_idx" ON "Assessment"("status", "type");

-- CreateIndex
CREATE INDEX "AssessmentSection_assessmentId_idx" ON "AssessmentSection"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSection_assessmentId_position_key" ON "AssessmentSection"("assessmentId", "position");

-- CreateIndex
CREATE INDEX "AssessmentBlueprint_assessmentId_idx" ON "AssessmentBlueprint"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentBlueprint_categoryId_difficulty_idx" ON "AssessmentBlueprint"("categoryId", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentBlueprint_sectionId_categoryId_difficulty_key" ON "AssessmentBlueprint"("sectionId", "categoryId", "difficulty");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_candidateId_status_idx" ON "AssessmentAttempt"("candidateId", "status");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_assessmentId_status_idx" ON "AssessmentAttempt"("assessmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_assessmentId_candidateId_key" ON "AssessmentAttempt"("assessmentId", "candidateId");

-- CreateIndex
CREATE INDEX "AttemptQuestion_attemptId_sectionId_idx" ON "AttemptQuestion"("attemptId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_questionId_key" ON "AttemptQuestion"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_displayOrder_key" ON "AttemptQuestion"("attemptId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateResponse_attemptQuestionId_key" ON "CandidateResponse"("attemptQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringDimension_name_key" ON "ScoringDimension"("name");

-- CreateIndex
CREATE INDEX "QuestionDimensionMapping_dimensionId_idx" ON "QuestionDimensionMapping"("dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionDimensionMapping_questionId_dimensionId_key" ON "QuestionDimensionMapping"("questionId", "dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_attemptId_key" ON "AssessmentResult"("attemptId");

-- CreateIndex
CREATE INDEX "AssessmentResult_percentage_idx" ON "AssessmentResult"("percentage");
