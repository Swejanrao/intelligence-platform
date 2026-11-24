import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../config/database";

type AuthResponse = { token: string };
type SafeQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  options: { id: string; text: string }[];
  answer: unknown;
};
type SafeAttempt = { id: string; status: string; questions: SafeQuestion[] };

const createdUserIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdDimensionIds: string[] = [];
const createdAssessmentIds: string[] = [];
let adminToken = "";
let candidateToken = "";
let otherCandidateToken = "";
let technicalAssessmentId = "";
let psychometricAssessmentId = "";
let technicalCategoryId = "";
let psychometricCategoryId = "";

async function signIn(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/sign-in")
    .send({ email, password: "Workflow@123" }).expect(200);
  return (response.body as AuthResponse).token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("assessment API workflows", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [
      resolve(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "db", "push", "--force-reset", "--accept-data-loss"
    ], { cwd: process.cwd(), env: process.env, stdio: "pipe" });

    const passwordHash = await bcrypt.hash("Workflow@123", 4);
    const admin = await prisma.user.create({ data: {
      name: "Workflow Admin", email: "admin@workflow.local", passwordHash, role: "ADMIN"
    } });
    const candidate = await prisma.user.create({ data: {
      name: "Workflow Candidate", email: "candidate@workflow.local", passwordHash, role: "CANDIDATE"
    } });
    const otherCandidate = await prisma.user.create({ data: {
      name: "Second Candidate", email: "second@workflow.local", passwordHash, role: "CANDIDATE"
    } });
    createdUserIds.push(admin.id, candidate.id, otherCandidate.id);
    [adminToken, candidateToken, otherCandidateToken] = await Promise.all([
      signIn(admin.email), signIn(candidate.email), signIn(otherCandidate.email)
    ]);

    const technicalCategory = await prisma.questionCategory.create({ data: { name: "Workflow Technical" } });
    const psychometricCategory = await prisma.questionCategory.create({ data: { name: "Workflow Psychometric" } });
    const reversedDimension = await prisma.scoringDimension.create({ data: { name: "Workflow Reversed" } });
    const positiveDimension = await prisma.scoringDimension.create({ data: { name: "Workflow Positive" } });
    createdCategoryIds.push(technicalCategory.id, psychometricCategory.id);
    createdDimensionIds.push(reversedDimension.id, positiveDimension.id);
    technicalCategoryId = technicalCategory.id;
    psychometricCategoryId = psychometricCategory.id;

    await Promise.all(Array.from({ length: 4 }, (_, index) => prisma.question.create({
      data: {
        text: `Workflow technical item ${index + 1}`,
        type: "SINGLE_CHOICE",
        categoryId: technicalCategory.id,
        difficulty: "EASY",
        marks: 2,
        negativeMarks: 0.5,
        options: { create: [
          { text: "Correct answer", isCorrect: true, position: 0 },
          { text: "Distractor", isCorrect: false, position: 1 }
        ] }
      }
    })));
    await prisma.question.create({
      data: {
        text: "Workflow psychometric item",
        type: "LIKERT",
        categoryId: psychometricCategory.id,
        difficulty: "MIXED",
        marks: 0,
        dimensionMappings: { create: [
          { dimensionId: reversedDimension.id, weight: 1, reverseScored: true, direction: "REVERSE" },
          { dimensionId: positiveDimension.id, weight: 2, reverseScored: false, direction: "POSITIVE" }
        ] }
      }
    });

    const technical = await request(app).post("/api/assessments").set(auth(adminToken)).send({
      title: "Workflow Technical Assessment",
      type: "TECHNICAL",
      durationMinutes: 20,
      negativeMarking: true,
      sections: [{ title: "Core", quotas: [{ categoryId: technicalCategory.id, difficulty: "EASY", requiredCount: 2 }] }]
    }).expect(201);
    technicalAssessmentId = technical.body.id as string;
    createdAssessmentIds.push(technicalAssessmentId);
    await request(app).post(`/api/assessments/${technicalAssessmentId}/publish`).set(auth(adminToken)).send({}).expect(200);

    const psychometric = await request(app).post("/api/assessments").set(auth(adminToken)).send({
      title: "Workflow Psychometric Assessment",
      type: "PSYCHOMETRIC",
      durationMinutes: 10,
      sections: [{ title: "Profile", quotas: [{ categoryId: psychometricCategory.id, difficulty: "MIXED", requiredCount: 1 }] }]
    }).expect(201);
    psychometricAssessmentId = psychometric.body.id as string;
    createdAssessmentIds.push(psychometricAssessmentId);
    await request(app).post(`/api/assessments/${psychometricAssessmentId}/publish`).set(auth(adminToken)).send({}).expect(200);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.assessmentAttempt.deleteMany({ where: { candidateId: { in: createdUserIds } } });
    }
    if (createdAssessmentIds.length) {
      await prisma.assessmentAttempt.deleteMany({ where: { assessmentId: { in: createdAssessmentIds } } });
      await prisma.assessment.deleteMany({ where: { id: { in: createdAssessmentIds } } });
    }
    if (createdCategoryIds.length) {
      await prisma.question.deleteMany({ where: { categoryId: { in: createdCategoryIds } } });
      await prisma.questionCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    }
    if (createdDimensionIds.length) await prisma.scoringDimension.deleteMany({ where: { id: { in: createdDimensionIds } } });
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("keeps candidate attempts safe, resumable, unique and immutable after archive", async () => {
    const candidateAssessments = await request(app).get("/api/assessments").set(auth(candidateToken)).expect(200);
    expect(JSON.stringify(candidateAssessments.body)).not.toMatch(/negativeMarking|shuffleOptions|shuffleQuestions/);

    const start = await request(app).post(`/api/assessments/${technicalAssessmentId}/attempts`)
      .set(auth(candidateToken)).send({}).expect(201);
    const attempt = start.body as SafeAttempt;
    expect(attempt.questions).toHaveLength(2);
    expect(new Set(attempt.questions.map((question) => question.id)).size).toBe(2);
    expect(JSON.stringify(attempt)).not.toMatch(/isCorrect|correctOptionIds|scoreValue|metadataSnapshot|marksSnapshot|marks/);

    const duplicateStart = await request(app).post(`/api/assessments/${technicalAssessmentId}/attempts`)
      .set(auth(candidateToken)).send({}).expect(200);
    expect((duplicateStart.body as SafeAttempt).id).toBe(attempt.id);
    await request(app).get(`/api/attempts/${attempt.id}`).set(auth(otherCandidateToken)).expect(404);

    const sourceQuestions = await Promise.all(attempt.questions.map((question) =>
      prisma.attemptQuestion.findUniqueOrThrow({
        where: { id: question.id },
        include: { question: { include: { options: true } } }
      })
    ));
    const correctId = sourceQuestions[0].question.options.find((option) => option.isCorrect)!.id;
    const wrongId = sourceQuestions[1].question.options.find((option) => !option.isCorrect)!.id;
    await request(app).put(`/api/attempts/${attempt.id}/responses`).set(auth(candidateToken))
      .send({ questionId: attempt.questions[0].id, answer: correctId }).expect(200);
    await request(app).put(`/api/attempts/${attempt.id}/responses`).set(auth(candidateToken))
      .send({ questionId: attempt.questions[1].id, answer: wrongId }).expect(200);
    const resumed = await request(app).get(`/api/attempts/${attempt.id}`).set(auth(candidateToken)).expect(200);
    expect((resumed.body as SafeAttempt).questions[0].id).toBe(attempt.questions[0].id);
    expect((resumed.body as SafeAttempt).questions[0].answer).toBe(correctId);

    const adminQuestions = await request(app).get("/api/questions?status=ACTIVE").set(auth(adminToken)).expect(200);
    const sourceId = sourceQuestions[0].questionId;
    expect(adminQuestions.body.some((question: { id: string }) => question.id === sourceId)).toBe(true);
    await request(app).post(`/api/questions/${sourceId}/archive`).set(auth(adminToken))
      .send({ confirm: true }).expect(200);
    const archivedResume = await request(app).get(`/api/attempts/${attempt.id}`).set(auth(candidateToken)).expect(200);
    expect((archivedResume.body as SafeAttempt).questions[0].questionText).toBe(attempt.questions[0].questionText);

    const submit = await request(app).post(`/api/attempts/${attempt.id}/submit`).set(auth(candidateToken)).send({}).expect(200);
    const repeatSubmit = await request(app).post(`/api/attempts/${attempt.id}/submit`).set(auth(candidateToken)).send({}).expect(200);
    expect(repeatSubmit.body.attemptId).toBe(submit.body.attemptId);
    expect(submit.body.technicalScore).toBe(1.5);
    expect(await prisma.assessmentResult.count({ where: { attemptId: attempt.id } })).toBe(1);
    await request(app).get("/api/questions").set(auth(candidateToken)).expect(403);
  });

  it("scores reversed multi-dimension items and blocks publication when pools are short", async () => {
    const started = await request(app).post(`/api/assessments/${psychometricAssessmentId}/attempts`)
      .set(auth(candidateToken)).send({}).expect(201);
    const attempt = started.body as SafeAttempt;
    await request(app).put(`/api/attempts/${attempt.id}/responses`).set(auth(candidateToken))
      .send({ questionId: attempt.questions[0].id, answer: 2 }).expect(200);
    const result = await request(app).post(`/api/attempts/${attempt.id}/submit`)
      .set(auth(candidateToken)).send({}).expect(200);
    const dimensions = result.body.dimensionScores as { name: string; score: number }[];
    expect(dimensions.find((dimension) => dimension.name === "Workflow Reversed")?.score).toBe(4);
    expect(dimensions.find((dimension) => dimension.name === "Workflow Positive")?.score).toBe(2);
    expect(result.body.illustrativeNotice).toContain("Not a clinical or diagnostic result");

    const short = await request(app).post("/api/assessments").set(auth(adminToken)).send({
      title: "Workflow Short Pool Assessment",
      type: "TECHNICAL",
      durationMinutes: 10,
      sections: [{ title: "Short pool", quotas: [{ categoryId: technicalCategoryId, difficulty: "HARD", requiredCount: 100 }] }]
    }).expect(201);
    createdAssessmentIds.push(short.body.id as string);
    const publish = await request(app).post(`/api/assessments/${short.body.id}/publish`)
      .set(auth(adminToken)).send({}).expect(409);
    expect(publish.body.error.code).toBe("INSUFFICIENT_QUESTIONS");
    expect(publish.body.error.shortages).toHaveLength(1);
  });
});
