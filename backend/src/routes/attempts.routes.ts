import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { allocateQuestions } from "../services/allocation";
import { scoreAttempt } from "../services/scoring";
import { errorResponse, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const answerSchema = z.union([
  z.string().min(1).max(200),
  z.array(z.string().min(1).max(200)).max(100),
  z.number().int().min(1).max(5)
]);
const randomize = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

function safeAttempt(attempt: {
  id: string;
  assessmentId: string;
  status: string;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  questions: Array<{
    id: string;
    questionText: string;
    questionType: string;
    optionsSnapshot: string;
    marksSnapshot: number;
    displayOrder: number;
    flagged: boolean;
    section: { id: string; title: string };
    response: { responseJson: string } | null;
  }>;
  assessment: { title: string; durationMinutes: number };
}) {
  return {
    id: attempt.id,
    assessmentId: attempt.assessmentId,
    assessmentTitle: attempt.assessment.title,
    durationMinutes: attempt.assessment.durationMinutes,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    questions: attempt.questions.map((question) => ({
      id: question.id,
      questionText: question.questionText,
      questionType: question.questionType,
      options: (JSON.parse(question.optionsSnapshot) as { id: string; text: string }[])
        .map(({ id, text }) => ({ id, text })),
      displayOrder: question.displayOrder,
      flagged: question.flagged,
      section: question.section,
      answer: question.response ? JSON.parse(question.response.responseJson) as unknown : null
    }))
  };
}

async function loadAttempt(attemptId: string) {
  return prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      assessment: true,
      questions: {
        orderBy: { displayOrder: "asc" },
        include: { section: { select: { id: true, title: true } }, response: true }
      }
    }
  });
}

async function submitAttempt(attemptId: string) {
  return prisma.$transaction(async (transaction) => {
    const attempt = await transaction.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: true,
        questions: {
          include: { section: { select: { id: true, title: true } }, response: true }
        },
        result: true
      }
    });
    if (!attempt) return null;
    if (attempt.status === "SUBMITTED" && attempt.result) return attempt.result;

    const scores = scoreAttempt(attempt.questions.map((question) => ({
      sectionId: question.sectionId,
      sectionTitle: question.section.title,
      questionType: question.questionType,
      marksSnapshot: question.marksSnapshot,
      negativeSnapshot: question.negativeSnapshot,
      metadataSnapshot: question.metadataSnapshot,
      responseJson: question.response?.responseJson ?? null
    })), attempt.assessment.negativeMarking);

    const result = await transaction.assessmentResult.upsert({
      where: { attemptId: attempt.id },
      create: {
        attemptId: attempt.id,
        technicalScore: scores.technicalScore,
        maximumScore: scores.maximumScore,
        percentage: scores.percentage,
        sectionScoresJson: JSON.stringify(scores.sectionScores),
        dimensionScoresJson: JSON.stringify(scores.dimensionScores)
      },
      update: {}
    });
    await transaction.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: "SUBMITTED", submittedAt: attempt.submittedAt ?? new Date() }
    });
    return result;
  });
}

router.post("/assessments/:id/attempts", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const assessment = await prisma.assessment.findUnique({
    where: { id: req.params.id },
    include: {
      sections: true,
      blueprints: { include: { section: true } }
    }
  });
  if (!assessment || assessment.status !== "PUBLISHED") {
    return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Published assessment not found");
  }
  const existing = await prisma.assessmentAttempt.findUnique({
    where: { assessmentId_candidateId: { assessmentId: assessment.id, candidateId: req.user!.id } }
  });
  if (existing) {
    if (existing.status === "IN_PROGRESS" && existing.expiresAt <= new Date()) await submitAttempt(existing.id);
    const attempt = await loadAttempt(existing.id);
    return res.json(safeAttempt(attempt!));
  }

  const isTechnical = assessment.type === "TECHNICAL";
  const pools = await Promise.all(assessment.blueprints.map(async (blueprint) => ({
    sectionId: blueprint.sectionId,
    sectionTitle: blueprint.section.title,
    requiredCount: blueprint.requiredCount,
    questions: await prisma.question.findMany({
      where: {
        categoryId: blueprint.categoryId,
        difficulty: blueprint.difficulty,
        status: "ACTIVE",
        type: isTechnical
          ? { in: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SQL"] }
          : { in: ["LIKERT", "SITUATIONAL_JUDGMENT"] }
      },
      include: { options: { orderBy: { position: "asc" } }, dimensionMappings: { include: { dimension: true } } }
    })
  })));

  let allocated;
  try {
    allocated = allocateQuestions(pools);
  } catch {
    return errorResponse(res, 409, "BLUEPRINT_UNAVAILABLE", "The assessment no longer has enough distinct active questions");
  }

  const now = new Date();
  try {
    const attempt = await prisma.$transaction(async (transaction) => {
      const created = await transaction.assessmentAttempt.create({
        data: {
          assessmentId: assessment.id,
          candidateId: req.user!.id,
          expiresAt: new Date(now.getTime() + assessment.durationMinutes * 60_000),
          questions: {
            create: allocated.map(({ question, sectionId }, displayOrder) => {
              const options = randomize(question.options);
              return {
                questionId: question.id,
                sectionId,
                displayOrder,
                questionText: question.text,
                questionType: question.type,
                optionsSnapshot: JSON.stringify(options.map((option) => ({
                  id: option.id,
                  text: option.text,
                  ...(option.scoreValue !== null ? { scoreValue: option.scoreValue } : {})
                }))),
                marksSnapshot: question.marks,
                negativeSnapshot: question.negativeMarks,
                metadataSnapshot: JSON.stringify({
                  correctOptionIds: question.options.filter((option) => option.isCorrect).map((option) => option.id),
                  optionScores: Object.fromEntries(question.options
                    .filter((option) => option.scoreValue !== null)
                    .map((option) => [option.id, option.scoreValue])),
                  dimensions: question.dimensionMappings.map((mapping) => ({
                    id: mapping.dimensionId,
                    name: mapping.dimension.name,
                    weight: mapping.weight,
                    reverseScored: mapping.reverseScored
                  }))
                })
              };
            })
          }
        },
        include: {
          assessment: true,
          questions: {
            orderBy: { displayOrder: "asc" },
            include: { section: { select: { id: true, title: true } }, response: true }
          }
        }
      });
      return created;
    });
    return res.status(201).json(safeAttempt(attempt));
  } catch (error) {
    const conflict = error as { code?: string };
    if (conflict.code !== "P2002") throw error;
    const racedAttempt = await prisma.assessmentAttempt.findUnique({
      where: { assessmentId_candidateId: { assessmentId: assessment.id, candidateId: req.user!.id } },
      select: { id: true }
    });
    if (!racedAttempt) throw error;
    return res.json(safeAttempt((await loadAttempt(racedAttempt.id))!));
  }
});

router.get("/attempts/:id", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const attempt = await loadAttempt(req.params.id);
  if (!attempt || attempt.candidateId !== req.user!.id) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status === "IN_PROGRESS" && attempt.expiresAt <= new Date()) {
    await submitAttempt(attempt.id);
    const completed = await loadAttempt(attempt.id);
    return res.json(safeAttempt(completed!));
  }
  return res.json(safeAttempt(attempt));
});

router.put("/attempts/:id/responses", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const parsed = z.object({ questionId: z.string().min(1), answer: answerSchema }).safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", "Answer is invalid");
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.id },
    include: { questions: true }
  });
  if (!attempt || attempt.candidateId !== req.user!.id) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status !== "IN_PROGRESS" || attempt.expiresAt <= new Date()) {
    return errorResponse(res, 409, "ATTEMPT_CLOSED", "This attempt is no longer accepting answers");
  }
  const question = attempt.questions.find((item) => item.id === parsed.data.questionId);
  if (!question) return errorResponse(res, 404, "ATTEMPT_QUESTION_NOT_FOUND", "Question is not part of this attempt");
  const options = JSON.parse(question.optionsSnapshot) as { id: string; text: string }[];
  const answer = parsed.data.answer;
  if (question.questionType === "MULTIPLE_CHOICE" && Array.isArray(answer) && answer.length === 0) {
    await prisma.candidateResponse.deleteMany({ where: { attemptQuestionId: question.id } });
    return res.json({ status: "saved", savedAt: new Date() });
  }
  if (question.questionType === "LIKERT") {
    if (typeof answer !== "number") return errorResponse(res, 400, "INVALID_ANSWER", "Choose a Likert value from 1 to 5");
  } else if (question.questionType === "SITUATIONAL_JUDGMENT" || question.questionType === "SINGLE_CHOICE" || question.questionType === "SQL") {
    if (typeof answer !== "string" || !options.some((option) => option.id === answer)) {
      return errorResponse(res, 400, "INVALID_ANSWER", "Choose one of the available options");
    }
  } else if (!Array.isArray(answer) || new Set(answer).size !== answer.length ||
      answer.some((id) => !options.some((option) => option.id === id))) {
    return errorResponse(res, 400, "INVALID_ANSWER", "Choose one or more available options");
  }

  const response = await prisma.candidateResponse.upsert({
    where: { attemptQuestionId: question.id },
    create: { attemptQuestionId: question.id, responseJson: JSON.stringify(answer) },
    update: { responseJson: JSON.stringify(answer), savedAt: new Date() }
  });
  return res.json({ status: "saved", savedAt: response.savedAt });
});

router.patch("/attempts/:id/flag", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const parsed = z.object({ questionId: z.string().min(1), flagged: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", "Flag update is invalid");
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: req.params.id } });
  if (!attempt || attempt.candidateId !== req.user!.id) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status !== "IN_PROGRESS" || attempt.expiresAt <= new Date()) return errorResponse(res, 409, "ATTEMPT_CLOSED", "This attempt is no longer active");
  const updated = await prisma.attemptQuestion.updateMany({
    where: { id: parsed.data.questionId, attemptId: attempt.id },
    data: { flagged: parsed.data.flagged }
  });
  if (!updated.count) return errorResponse(res, 404, "ATTEMPT_QUESTION_NOT_FOUND", "Question is not part of this attempt");
  return res.json({ questionId: parsed.data.questionId, flagged: parsed.data.flagged });
});

router.post("/attempts/:id/submit", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: req.params.id } });
  if (!attempt || attempt.candidateId !== req.user!.id) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  const result = await submitAttempt(attempt.id);
  if (!result) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  return res.json(resultPayload(result));
});

router.get("/attempts/:id/result", requireAuth, requireRole("CANDIDATE"), async (req, res) => {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.id },
    include: { result: true }
  });
  if (!attempt || attempt.candidateId !== req.user!.id) return errorResponse(res, 404, "ATTEMPT_NOT_FOUND", "Attempt not found");
  if (attempt.status !== "SUBMITTED" || !attempt.result) return errorResponse(res, 409, "RESULT_NOT_READY", "Submit the attempt before viewing results");
  return res.json(resultPayload(attempt.result));
});

function resultPayload(result: {
  attemptId: string;
  technicalScore: number;
  maximumScore: number;
  percentage: number;
  sectionScoresJson: string;
  dimensionScoresJson: string;
  illustrativeNotice: string;
  calculatedAt: Date;
}) {
  return {
    attemptId: result.attemptId,
    technicalScore: result.technicalScore,
    maximumScore: result.maximumScore,
    percentage: result.percentage,
    sectionScores: JSON.parse(result.sectionScoresJson) as unknown,
    dimensionScores: JSON.parse(result.dimensionScoresJson) as unknown,
    illustrativeNotice: result.illustrativeNotice,
    calculatedAt: result.calculatedAt
  };
}

router.get("/results", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const results = await prisma.assessmentResult.findMany({
    include: {
      attempt: { include: { candidate: { select: { id: true, name: true, email: true } }, assessment: { select: { id: true, title: true, type: true } } } }
    },
    orderBy: { calculatedAt: "desc" },
    take: 100
  });
  return res.json(results.map((result) => ({
    id: result.id,
    attemptId: result.attemptId,
    candidate: result.attempt.candidate,
    assessment: result.attempt.assessment,
    technicalScore: result.technicalScore,
    maximumScore: result.maximumScore,
    percentage: result.percentage,
    sectionScores: JSON.parse(result.sectionScoresJson) as unknown,
    dimensionScores: JSON.parse(result.dimensionScoresJson) as unknown,
    illustrativeNotice: result.illustrativeNotice,
    calculatedAt: result.calculatedAt
  })));
});

export default router;
