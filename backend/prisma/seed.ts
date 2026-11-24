import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Assessment@123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@assessment.local" },
    update: { name: "Platform Admin", role: "ADMIN", isActive: true },
    create: { name: "Platform Admin", email: "admin@assessment.local", passwordHash, role: "ADMIN" }
  });

  const candidates = await Promise.all([
    ["Aarav Candidate", "aarav@assessment.local"],
    ["Mira Candidate", "mira@assessment.local"],
    ["Dev Candidate", "dev@assessment.local"]
  ].map(([name, email]) => prisma.user.upsert({
    where: { email },
    update: { name, role: "CANDIDATE", isActive: true },
    create: { name, email, passwordHash, role: "CANDIDATE" }
  })));

  const categoryNames = ["SQL", "Python", "Data Modeling", "Analytical Thinking", "Adaptability", "Communication", "Ownership"];
  const categories: Record<string, string> = {};
  for (const name of categoryNames) {
    const category = await prisma.questionCategory.upsert({
      where: { name }, update: {}, create: { name, description: `${name} assessment category` }
    });
    categories[name] = category.id;
  }

  const dimensionNames = ["Analytical Thinking", "Adaptability", "Communication", "Ownership"];
  const dimensions: Record<string, string> = {};
  for (const name of dimensionNames) {
    const dimension = await prisma.scoringDimension.upsert({
      where: { name }, update: {}, create: { name, description: `${name} competency dimension` }
    });
    dimensions[name] = dimension.id;
  }

  const technicalQuestions = [
    ["Which SQL statement retrieves rows from a table?", "SQL", "EASY", "SELECT", ["SELECT", "UPDATE", "DELETE", "INSERT"]],
    ["Which clause filters rows before grouping?", "SQL", "EASY", "WHERE", ["WHERE", "HAVING", "ORDER BY", "LIMIT"]],
    ["Which SQL keyword removes duplicate rows from a result?", "SQL", "EASY", "DISTINCT", ["DISTINCT", "UNIQUE KEY", "REMOVE", "DEDUP"]],
    ["Which function counts rows?", "SQL", "MEDIUM", "COUNT", ["COUNT", "SUM", "AVG", "ROUND"]],
    ["Which join returns matching rows from both tables?", "SQL", "MEDIUM", "INNER JOIN", ["INNER JOIN", "CROSS JOIN", "FULL OUTER JOIN", "SELF JOIN"]],
    ["Which clause filters grouped results?", "SQL", "MEDIUM", "HAVING", ["HAVING", "WHERE", "FROM", "SELECT"]],
    ["Which database property ensures a transaction is all-or-nothing?", "SQL", "HARD", "Atomicity", ["Atomicity", "Isolation", "Durability", "Consistency"]],
    ["Which constraint prevents duplicate values in a column?", "SQL", "HARD", "UNIQUE", ["UNIQUE", "DEFAULT", "CHECK", "FOREIGN KEY"]],
    ["Which SQL feature ranks rows within a partition?", "SQL", "HARD", "Window function", ["Window function", "Trigger", "View", "Stored procedure"]],
    ["Which Python type is immutable?", "Python", "EASY", "tuple", ["tuple", "list", "dict", "set"]],
    ["Which keyword defines a function?", "Python", "EASY", "def", ["def", "func", "function", "lambda"]],
    ["What does len() return?", "Python", "EASY", "Number of items", ["Number of items", "Memory size", "Data type", "Index of last item"]],
    ["Which collection stores key-value pairs?", "Python", "MEDIUM", "dict", ["dict", "tuple", "list", "set"]],
    ["What does enumerate() provide?", "Python", "MEDIUM", "Index and value", ["Index and value", "Only values", "Only indexes", "Sorted values"]],
    ["Which statement handles exceptions?", "Python", "MEDIUM", "try/except", ["try/except", "if/else", "for/while", "with/import"]],
    ["What is the average lookup complexity of a dictionary?", "Python", "HARD", "O(1)", ["O(1)", "O(n)", "O(log n)", "O(n squared)"]],
    ["What does a generator yield?", "Python", "HARD", "Values lazily", ["Values lazily", "All values immediately", "Only strings", "A dictionary"]],
    ["Which principle hides internal object details?", "Data Modeling", "EASY", "Encapsulation", ["Encapsulation", "Inheritance", "Polymorphism", "Normalization"]],
    ["What does a foreign key enforce?", "Data Modeling", "MEDIUM", "Referential integrity", ["Referential integrity", "Sorting", "Encryption", "Compression"]],
    ["Which normal form removes partial dependencies on a composite key?", "Data Modeling", "HARD", "Second normal form", ["Second normal form", "First normal form", "Third normal form", "Boyce-Codd normal form"]]
  ] as const;

  for (let i = 0; i < technicalQuestions.length; i++) {
    const [text, categoryName, difficulty, correct, options] = technicalQuestions[i];
    const existing = await prisma.question.findFirst({ where: { text } });
    if (!existing) {
      await prisma.question.create({
        data: {
          text, type: "SINGLE_CHOICE", categoryId: categories[categoryName], difficulty,
          topic: categoryName, skill: categoryName, status: "ACTIVE", marks: 2,
          negativeMarks: 0.5, createdById: admin.id,
          options: { create: options.map((option, position) => ({ text: option, isCorrect: option === correct, position })) }
        }
      });
    }
  }

  const psychometricItems = [
    ["I enjoy breaking complex problems into smaller parts.", "Analytical Thinking", "Analytical Thinking", false],
    ["I use evidence before making an important decision.", "Analytical Thinking", "Analytical Thinking", false],
    ["I can identify patterns in unfamiliar information.", "Analytical Thinking", "Analytical Thinking", false],
    ["I avoid reviewing data when making decisions.", "Analytical Thinking", "Analytical Thinking", true],
    ["I adapt quickly when priorities change.", "Adaptability", "Adaptability", false],
    ["I remain productive when plans change unexpectedly.", "Adaptability", "Adaptability", false],
    ["I find it difficult to adjust to new tools.", "Adaptability", "Adaptability", true],
    ["I actively seek feedback to improve my work.", "Adaptability", "Adaptability", false],
    ["I explain technical ideas clearly to others.", "Communication", "Communication", false],
    ["I listen carefully before responding.", "Communication", "Communication", false],
    ["I avoid sharing progress with teammates.", "Communication", "Communication", true],
    ["I communicate blockers early.", "Communication", "Communication", false],
    ["I take responsibility for completing agreed tasks.", "Ownership", "Ownership", false],
    ["I follow through on commitments.", "Ownership", "Ownership", false],
    ["I wait for others to solve problems I own.", "Ownership", "Ownership", true]
  ] as const;

  for (const [text, categoryName, dimensionName, reverseScored] of psychometricItems) {
    const existing = await prisma.question.findFirst({ where: { text } });
    if (!existing) {
      await prisma.question.create({
        data: {
          text, type: "LIKERT", categoryId: categories[categoryName], difficulty: "MIXED",
          topic: categoryName, skill: dimensionName, status: "ACTIVE", marks: 0,
          negativeMarks: 0, createdById: admin.id,
          dimensionMappings: { create: { dimensionId: dimensions[dimensionName], weight: 1, direction: reverseScored ? "REVERSE" : "POSITIVE", reverseScored } }
        }
      });
    }
  }

  const tech = await prisma.assessment.upsert({
    where: { id: "seed-technical-assessment" },
    update: {},
    create: {
      id: "seed-technical-assessment", title: "Technical Skills Assessment",
      description: "Synthetic demo assessment covering SQL, Python and data modeling.",
      type: "TECHNICAL", status: "PUBLISHED", durationMinutes: 30,
      negativeMarking: true, createdById: admin.id,
      sections: { create: [
        { id: "seed-tech-section-sql", title: "SQL", position: 0 },
        { id: "seed-tech-section-programming", title: "Programming and Data", position: 1 }
      ] }
    }
  });
  const techSections = await prisma.assessmentSection.findMany({ where: { assessmentId: tech.id } });
  const sqlSection = techSections.find(s => s.title === "SQL")!;
  const programmingSection = techSections.find(s => s.title === "Programming and Data")!;
  const techBlueprints = [
    { sectionId: sqlSection.id, categoryId: categories.SQL, difficulty: "EASY", requiredCount: 2 },
    { sectionId: sqlSection.id, categoryId: categories.SQL, difficulty: "MEDIUM", requiredCount: 2 },
    { sectionId: sqlSection.id, categoryId: categories.SQL, difficulty: "HARD", requiredCount: 1 },
    { sectionId: programmingSection.id, categoryId: categories.Python, difficulty: "EASY", requiredCount: 2 },
    { sectionId: programmingSection.id, categoryId: categories.Python, difficulty: "MEDIUM", requiredCount: 2 },
    { sectionId: programmingSection.id, categoryId: categories.Python, difficulty: "HARD", requiredCount: 1 },
    { sectionId: programmingSection.id, categoryId: categories["Data Modeling"], difficulty: "EASY", requiredCount: 1 },
    { sectionId: programmingSection.id, categoryId: categories["Data Modeling"], difficulty: "MEDIUM", requiredCount: 1 }
  ];
  for (const item of techBlueprints) {
    await prisma.assessmentBlueprint.upsert({
      where: { sectionId_categoryId_difficulty: { sectionId: item.sectionId, categoryId: item.categoryId, difficulty: item.difficulty } },
      update: { requiredCount: item.requiredCount }, create: { assessmentId: tech.id, ...item }
    });
  }

  const psych = await prisma.assessment.upsert({
    where: { id: "seed-psychometric-assessment" },
    update: {},
    create: {
      id: "seed-psychometric-assessment", title: "Work Style and Competency Assessment",
      description: "Synthetic five-point Likert assessment. Results are illustrative, not diagnostic.",
      type: "PSYCHOMETRIC", status: "PUBLISHED", durationMinutes: 20,
      negativeMarking: false, createdById: admin.id,
      sections: { create: [
        { id: "seed-psych-section-core", title: "Work Style and Competencies", position: 0 }
      ] }
    }
  });
  const psychSection = await prisma.assessmentSection.findFirstOrThrow({ where: { assessmentId: psych.id } });
  for (const categoryName of ["Analytical Thinking", "Adaptability", "Communication", "Ownership"]) {
    await prisma.assessmentBlueprint.upsert({
      where: { sectionId_categoryId_difficulty: { sectionId: psychSection.id, categoryId: categories[categoryName], difficulty: "MIXED" } },
      update: { requiredCount: 3 },
      create: { assessmentId: psych.id, sectionId: psychSection.id, categoryId: categories[categoryName], difficulty: "MIXED", requiredCount: 3 }
    });
  }

  console.log("Seed complete.");
  console.log("Admin: admin@assessment.local / Assessment@123");
  console.log("Candidates: aarav@assessment.local, mira@assessment.local, dev@assessment.local");
  console.log("Candidate password: Assessment@123");
  console.log(`Seeded ${candidates.length} candidate accounts and two demo assessments.`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
