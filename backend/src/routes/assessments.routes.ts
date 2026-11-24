import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { allocateQuestions } from "../services/allocation";
import { errorResponse, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const quotaSchema = z.object({
  categoryId: z.string().min(1),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD", "MIXED"]),
  requiredCount: z.number().int().min(1).max(100)
});
const createAssessmentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(["TECHNICAL", "PSYCHOMETRIC"]),
  durationMinutes: z.number().int().min(1).max(300),
  negativeMarking: z.boolean().default(false),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(100),
    quotas: z.array(quotaSchema).min(1)
  })).min(1).max(20)
}).superRefine((value, context) => {
  value.sections.forEach((section, sectionIndex) => {
    const quotaKeys = section.quotas.map((quota) => `${quota.categoryId}:${quota.difficulty}`);
    if (new Set(quotaKeys).size !== quotaKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", sectionIndex, "quotas"],
        message: "A section cannot repeat a category and difficulty quota"
      });
    }
  });
});
const blueprintSchema = z.object({ rows: z.array(z.object({
  sectionId: z.string().min(1),
  ...quotaSchema.shape
})).min(1) });

router.use(requireAuth);

router.get("/assessments", async (req, res) => {
  const isAdmin = req.user?.role === "ADMIN";
  const assessments = await prisma.assessment.findMany({
    where: isAdmin ? {} : { status: "PUBLISHED" },
    include: {
      sections: { orderBy: { position: "asc" }, select: { id: true, title: true, position: true } },
      ...(isAdmin ? { _count: { select: { attempts: true } } } : {})
    },
    orderBy: { updatedAt: "desc" }
  });
  if (!isAdmin) {
    return res.json(assessments.map(({ id, title, description, type, status, durationMinutes, sections }) => ({
      id, title, description, type, status, durationMinutes, sections
    })));
  }
  return res.json(assessments);
});

router.post("/assessments", requireRole("ADMIN"), async (req, res) => {
  const parsed = createAssessmentSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Assessment is invalid");
  const data = parsed.data;
  const categories = await prisma.questionCategory.findMany({
    where: { id: { in: [...new Set(data.sections.flatMap((section) => section.quotas.map((quota) => quota.categoryId)))] } }
  });
  const categoryIds = new Set(categories.map((category) => category.id));
  if (data.sections.some((section) => section.quotas.some((quota) => !categoryIds.has(quota.categoryId)))) {
    return errorResponse(res, 400, "INVALID_CATEGORY", "Blueprint includes an unknown question category");
  }
  const assessment = await prisma.$transaction(async (transaction) => {
    const created = await transaction.assessment.create({
      data: {
        title: data.title,
        description: data.description,
        type: data.type,
        durationMinutes: data.durationMinutes,
        negativeMarking: data.type === "TECHNICAL" && data.negativeMarking,
        createdById: req.user!.id,
        sections: { create: data.sections.map((section, position) => ({ title: section.title, position })) }
      }
    });
    const sections = await transaction.assessmentSection.findMany({
      where: { assessmentId: created.id },
      orderBy: { position: "asc" }
    });
    const rows = data.sections.flatMap((section, index) => section.quotas.map((quota) => ({
      assessmentId: created.id,
      sectionId: sections[index].id,
      categoryId: quota.categoryId,
      difficulty: quota.difficulty,
      requiredCount: quota.requiredCount
    })));
    await transaction.assessmentBlueprint.createMany({ data: rows });
    return transaction.assessment.findUniqueOrThrow({
      where: { id: created.id },
      include: { sections: { orderBy: { position: "asc" } }, blueprints: true }
    });
  });
  return res.status(201).json(assessment);
});

router.get("/assessments/:id", async (req, res) => {
  const assessment = await prisma.assessment.findUnique({
    where: { id: req.params.id },
    include: {
      sections: { orderBy: { position: "asc" } },
      ...(req.user?.role === "ADMIN" ? {
        blueprints: { include: { category: true, section: true } },
        _count: { select: { attempts: true } }
      } : {})
    }
  });
  if (!assessment || (req.user?.role !== "ADMIN" && assessment.status !== "PUBLISHED")) {
    return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  }

  if (req.user?.role !== "ADMIN") {
    return res.json({
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      type: assessment.type,
      status: assessment.status,
      durationMinutes: assessment.durationMinutes,
      sections: assessment.sections
    });
  }
  const rows = await Promise.all(assessment.blueprints.map(async (blueprint) => {
    const typeFilter = assessment.type === "TECHNICAL"
      ? { type: { in: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SQL"] } }
      : { type: { in: ["LIKERT", "SITUATIONAL_JUDGMENT"] } };
    const count = await prisma.question.count({
      where: {
        categoryId: blueprint.categoryId,
        difficulty: blueprint.difficulty,
        status: "ACTIVE",
        ...typeFilter
      }
    });
    return { ...blueprint, availableCount: count, short: count < blueprint.requiredCount };
  }));
  return res.json({ ...assessment, blueprints: rows });
});

router.patch("/assessments/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = z.object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    durationMinutes: z.number().int().min(1).max(300),
    negativeMarking: z.boolean()
  }).safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", "Assessment settings are invalid");
  const current = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!current) return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  if (current.status !== "DRAFT") return errorResponse(res, 409, "ASSESSMENT_LOCKED", "Only draft assessment settings can be changed");
  const assessment = await prisma.assessment.update({
    where: { id: current.id },
    data: {
      ...parsed.data,
      negativeMarking: current.type === "TECHNICAL" && parsed.data.negativeMarking
    }
  });
  return res.json(assessment);
});

router.put("/assessments/:id/blueprint", requireRole("ADMIN"), async (req, res) => {
  const parsed = blueprintSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Blueprint is invalid");
  const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!assessment) return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  if (assessment.status !== "DRAFT") return errorResponse(res, 409, "ASSESSMENT_LOCKED", "Unpublish the assessment before changing its blueprint");
  if (await prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id } })) {
    return errorResponse(res, 409, "ASSESSMENT_HAS_ATTEMPTS", "Blueprint cannot change after candidates have started");
  }
  const sectionIds = new Set((await prisma.assessmentSection.findMany({
    where: { assessmentId: assessment.id }, select: { id: true }
  })).map((section) => section.id));
  const categoryIds = new Set((await prisma.questionCategory.findMany({
    where: { id: { in: parsed.data.rows.map((row) => row.categoryId) } }, select: { id: true }
  })).map((category) => category.id));
  if (parsed.data.rows.some((row) => !sectionIds.has(row.sectionId) || !categoryIds.has(row.categoryId))) {
    return errorResponse(res, 400, "INVALID_BLUEPRINT_REFERENCE", "Every blueprint row must use an assessment section and an existing category");
  }
  const uniqueRows = new Set(parsed.data.rows.map((row) => `${row.sectionId}:${row.categoryId}:${row.difficulty}`));
  if (uniqueRows.size !== parsed.data.rows.length) {
    return errorResponse(res, 400, "DUPLICATE_BLUEPRINT_ROW", "Blueprint rows must be unique by section, category and difficulty");
  }
  await prisma.$transaction([
    prisma.assessmentBlueprint.deleteMany({ where: { assessmentId: assessment.id } }),
    prisma.assessmentBlueprint.createMany({
      data: parsed.data.rows.map((row) => ({ ...row, assessmentId: assessment.id }))
    })
  ]);
  return res.json(await prisma.assessmentBlueprint.findMany({
    where: { assessmentId: assessment.id },
    include: { section: true, category: true }
  }));
});

router.post("/assessments/:id/unpublish", requireRole("ADMIN"), async (req, res) => {
  const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!assessment) return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  if (assessment.status === "DRAFT") return res.json(assessment);
  if (await prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id } })) {
    return errorResponse(res, 409, "ASSESSMENT_HAS_ATTEMPTS", "An assessment cannot be unpublished after a candidate has started");
  }
  return res.json(await prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: "DRAFT" }
  }));
});

router.post("/assessments/:id/publish", requireRole("ADMIN"), async (req, res) => {
  const assessment = await prisma.assessment.findUnique({
    where: { id: req.params.id },
    include: { sections: true, blueprints: { include: { section: true, category: true } } }
  });
  if (!assessment) return errorResponse(res, 404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  if (assessment.status === "PUBLISHED") return res.json({ assessment, shortages: [] });
  if (!assessment.blueprints.length) return errorResponse(res, 409, "BLUEPRINT_REQUIRED", "Add at least one blueprint quota before publishing");

  const isTechnical = assessment.type === "TECHNICAL";
  const pools = await Promise.all(assessment.blueprints.map(async (blueprint) => {
    const questions = await prisma.question.findMany({
      where: {
        categoryId: blueprint.categoryId,
        difficulty: blueprint.difficulty,
        status: "ACTIVE",
        type: isTechnical
          ? { in: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SQL"] }
          : { in: ["LIKERT", "SITUATIONAL_JUDGMENT"] }
      },
      include: { options: true, dimensionMappings: { include: { dimension: true } } }
    });
    return {
      blueprint,
      pool: {
        sectionId: blueprint.sectionId,
        sectionTitle: blueprint.section.title,
        requiredCount: blueprint.requiredCount,
        questions
      }
    };
  }));
  const shortages = pools.filter(({ blueprint, pool }) => pool.questions.length < blueprint.requiredCount)
    .map(({ blueprint, pool }) => ({
      section: blueprint.section.title,
      category: blueprint.category.name,
      difficulty: blueprint.difficulty,
      required: blueprint.requiredCount,
      available: pool.questions.length
    }));
  if (shortages.length) return res.status(409).json({ error: {
    code: "INSUFFICIENT_QUESTIONS",
    message: `Not enough eligible questions: ${shortages.map((row) => `${row.section} / ${row.category} / ${row.difficulty} (${row.available}/${row.required})`).join("; ")}`,
    shortages
  } });

  try {
    allocateQuestions(pools.map(({ pool }) => pool));
  } catch (reason) {
    if (reason instanceof Error && reason.message === "Blueprint does not have enough distinct eligible questions") {
      return errorResponse(res, 409, "OVERLAPPING_QUOTAS", "Blueprint quotas cannot be met without reusing a question");
    }
    throw reason;
  }
  const published = await prisma.assessment.update({ where: { id: assessment.id }, data: { status: "PUBLISHED" } });
  return res.json({ assessment: published, shortages: [] });
});

export default router;
