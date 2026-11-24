import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { errorResponse, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const optionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean().optional(),
  scoreValue: z.number().int().min(1).max(5).optional()
});
const mappingSchema = z.object({
  dimensionId: z.string().min(1),
  weight: z.number().positive().max(100),
  reverseScored: z.boolean().default(false)
});
const questionSchema = z.object({
  text: z.string().trim().min(5).max(5000),
  type: z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SQL", "LIKERT", "SITUATIONAL_JUDGMENT"]),
  categoryId: z.string().min(1),
  topic: z.string().trim().max(120).optional().nullable(),
  skill: z.string().trim().max(120).optional().nullable(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD", "MIXED"]),
  marks: z.number().min(0).max(100),
  negativeMarks: z.number().min(0).max(100).default(0),
  options: z.array(optionSchema).default([]),
  dimensions: z.array(mappingSchema).default([])
}).superRefine((value, context) => {
  const isTechnical = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SQL"].includes(value.type);
  if (isTechnical && value.options.length < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Add at least two answer options" });
  }
  if (value.type === "SINGLE_CHOICE" && value.options.filter((option) => option.isCorrect).length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Choose exactly one correct option" });
  }
  if (value.type === "SQL" && value.options.filter((option) => option.isCorrect).length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Choose exactly one correct option" });
  }
  if (value.type === "MULTIPLE_CHOICE" && !value.options.some((option) => option.isCorrect)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Choose at least one correct option" });
  }
  if (value.type === "LIKERT" && value.dimensions.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "Map this item to a scoring dimension" });
  }
  if (value.type === "SITUATIONAL_JUDGMENT" &&
      (value.options.length < 2 || value.options.some((option) => option.scoreValue === undefined))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Each situational option needs a score from 1 to 5" });
  }
  if (["LIKERT", "SITUATIONAL_JUDGMENT"].includes(value.type) && value.dimensions.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "Map this item to at least one scoring dimension" });
  }
  if (new Set(value.dimensions.map((mapping) => mapping.dimensionId)).size !== value.dimensions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "A dimension can only be mapped once per item" });
  }
});

const includedQuestion = {
  category: true,
  options: { orderBy: { position: "asc" as const } },
  dimensionMappings: { include: { dimension: true } }
};

router.get("/categories", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const categories = await prisma.questionCategory.findMany({ orderBy: { name: "asc" } });
  return res.json(categories);
});

router.get("/dimensions", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const dimensions = await prisma.scoringDimension.findMany({ orderBy: { name: "asc" } });
  return res.json(dimensions);
});

router.get("/questions", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const difficulty = typeof req.query.difficulty === "string" ? req.query.difficulty.toUpperCase() : undefined;
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (status && !["ACTIVE", "ARCHIVED", "DRAFT"].includes(status)) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "Status filter is invalid");
  }
  if (difficulty && !["EASY", "MEDIUM", "HARD", "MIXED"].includes(difficulty)) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "Difficulty filter is invalid");
  }

  const questions = await prisma.question.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search ? { text: { contains: search } } : {})
    },
    include: includedQuestion,
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return res.json(questions);
});

router.post("/questions", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Question is invalid");
  const data = parsed.data;
  const category = await prisma.questionCategory.findUnique({ where: { id: data.categoryId } });
  if (!category) return errorResponse(res, 400, "INVALID_CATEGORY", "Select an existing question category");
  const dimensions = data.dimensions.length
    ? await prisma.scoringDimension.findMany({ where: { id: { in: data.dimensions.map((mapping) => mapping.dimensionId) } } })
    : [];
  if (dimensions.length !== data.dimensions.length) {
    return errorResponse(res, 400, "INVALID_DIMENSION", "Select existing scoring dimensions");
  }

  const question = await prisma.question.create({
    data: {
      text: data.text,
      type: data.type,
      categoryId: data.categoryId,
      topic: data.topic,
      skill: data.skill,
      difficulty: data.difficulty,
      marks: data.marks,
      negativeMarks: data.negativeMarks,
      createdById: req.user!.id,
      options: { create: data.options.map((option, position) => ({ ...option, position })) },
      dimensionMappings: { create: data.dimensions.map((mapping) => ({
        dimensionId: mapping.dimensionId,
        weight: mapping.weight,
        reverseScored: mapping.reverseScored,
        direction: mapping.reverseScored ? "REVERSE" : "POSITIVE"
      })) }
    },
    include: includedQuestion
  });
  return res.status(201).json(question);
});

router.patch("/questions/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Question is invalid");
  const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.status === "ARCHIVED") return errorResponse(res, 404, "QUESTION_NOT_FOUND", "Question not found or archived");
  const data = parsed.data;
  const [category, dimensions] = await Promise.all([
    prisma.questionCategory.findUnique({ where: { id: data.categoryId } }),
    prisma.scoringDimension.findMany({ where: { id: { in: data.dimensions.map((mapping) => mapping.dimensionId) } } })
  ]);
  if (!category) return errorResponse(res, 400, "INVALID_CATEGORY", "Select an existing question category");
  if (dimensions.length !== data.dimensions.length) return errorResponse(res, 400, "INVALID_DIMENSION", "Select existing scoring dimensions");

  const question = await prisma.question.update({
    where: { id: req.params.id },
    data: {
      text: data.text,
      type: data.type,
      categoryId: data.categoryId,
      topic: data.topic,
      skill: data.skill,
      difficulty: data.difficulty,
      marks: data.marks,
      negativeMarks: data.negativeMarks,
      options: {
        deleteMany: {},
        create: data.options.map((option, position) => ({ ...option, position }))
      },
      dimensionMappings: {
        deleteMany: {},
        create: data.dimensions.map((mapping) => ({
          dimensionId: mapping.dimensionId,
          weight: mapping.weight,
          reverseScored: mapping.reverseScored,
          direction: mapping.reverseScored ? "REVERSE" : "POSITIVE"
        }))
      }
    },
    include: includedQuestion
  });
  return res.json(question);
});

router.post("/questions/:id/archive", requireAuth, requireRole("ADMIN"), async (req, res) => {
  if (req.body?.confirm !== true) return errorResponse(res, 400, "CONFIRMATION_REQUIRED", "Confirm archiving this question");
  const question = await prisma.question.findUnique({ where: { id: req.params.id } });
  if (!question || question.status === "ARCHIVED") return errorResponse(res, 404, "QUESTION_NOT_FOUND", "Question not found");
  const archived = await prisma.question.update({
    where: { id: question.id },
    data: { status: "ARCHIVED", archivedAt: new Date() }
  });
  return res.json({ id: archived.id, status: archived.status, archivedAt: archived.archivedAt });
});

export default router;
