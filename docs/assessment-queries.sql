-- 1. Active question inventory by category and difficulty.
SELECT
  c.name AS category,
  q.difficulty,
  COUNT(*) AS available_questions
FROM Question q
JOIN QuestionCategory c ON c.id = q.categoryId
WHERE q.status = 'ACTIVE'
GROUP BY c.name, q.difficulty
ORDER BY c.name, q.difficulty;

-- 2. A randomized, duplicate-free blueprint candidate selection.
-- The first window assigns a question to only one quota row when pools overlap;
-- the second chooses up to each row's quota. Always validate the resulting
-- selected_count against requiredCount before publishing.
WITH eligible AS (
  SELECT
    b.id AS blueprintId,
    b.requiredCount,
    q.id AS questionId,
    COUNT(*) OVER (PARTITION BY b.id) AS poolSize
  FROM AssessmentBlueprint b
  JOIN Question q
    ON q.categoryId = b.categoryId
   AND q.difficulty = b.difficulty
   AND q.status = 'ACTIVE'
  WHERE b.assessmentId = :assessmentId
),
unique_pool AS (
  SELECT
    eligible.*,
    ROW_NUMBER() OVER (
      PARTITION BY questionId
      ORDER BY poolSize ASC, blueprintId
    ) AS poolAssignment
  FROM eligible
),
ranked_pool AS (
  SELECT
    unique_pool.*,
    ROW_NUMBER() OVER (
      PARTITION BY blueprintId
      ORDER BY RANDOM(), questionId
    ) AS quotaPosition
  FROM unique_pool
  WHERE poolAssignment = 1
)
SELECT blueprintId, questionId
FROM ranked_pool
WHERE quotaPosition <= requiredCount
ORDER BY blueprintId, quotaPosition;

-- 3. Section-wise score totals for each submitted candidate attempt.
SELECT
  a.candidateId,
  a.assessmentId,
  json_extract(section.value, '$.sectionTitle') AS section,
  json_extract(section.value, '$.score') AS score,
  json_extract(section.value, '$.maximumScore') AS maximumScore
FROM AssessmentResult r
JOIN AssessmentAttempt a ON a.id = r.attemptId
JOIN json_each(r.sectionScoresJson) section
WHERE a.status = 'SUBMITTED'
ORDER BY a.candidateId, a.assessmentId, section.key;

-- 4. Weighted psychometric dimension summaries, including reverse scoring.
-- The server calculates and persists these values at submit to preserve the
-- item's saved mapping snapshot even if an author later changes the bank.
SELECT
  a.candidateId,
  a.assessmentId,
  json_extract(dimension.value, '$.name') AS dimension,
  json_extract(dimension.value, '$.score') AS weightedAverage,
  json_extract(dimension.value, '$.responseCount') AS responseCount
FROM AssessmentResult r
JOIN AssessmentAttempt a ON a.id = r.attemptId
JOIN json_each(r.dimensionScoresJson) dimension
WHERE a.status = 'SUBMITTED'
ORDER BY a.candidateId, a.assessmentId, dimension.key;

-- 5. Candidate performance summary across submitted assessments.
WITH candidate_results AS (
  SELECT
    a.candidateId,
    a.assessmentId,
    r.percentage,
    r.technicalScore,
    r.maximumScore,
    ROW_NUMBER() OVER (
      PARTITION BY a.candidateId, a.assessmentId
      ORDER BY r.calculatedAt DESC
    ) AS resultOrder
  FROM AssessmentAttempt a
  JOIN AssessmentResult r ON r.attemptId = a.id
  WHERE a.status = 'SUBMITTED'
)
SELECT
  candidateId,
  assessmentId,
  COUNT(*) AS completedAssessments,
  ROUND(AVG(percentage), 2) AS averagePercentage,
  SUM(technicalScore) AS totalTechnicalScore,
  SUM(maximumScore) AS totalAvailableMarks
FROM candidate_results
WHERE resultOrder = 1
GROUP BY candidateId, assessmentId
ORDER BY candidateId, assessmentId;
