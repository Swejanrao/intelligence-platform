export type ScorableAttemptQuestion = {
  sectionId: string;
  sectionTitle: string;
  questionType: string;
  marksSnapshot: number;
  negativeSnapshot: number;
  metadataSnapshot: string;
  responseJson: string | null;
};

type QuestionMetadata = {
  correctOptionIds?: string[];
  optionScores?: Record<string, number>;
  dimensions?: { id: string; name: string; weight: number; reverseScored: boolean }[];
};

export type ScoreResult = {
  technicalScore: number;
  maximumScore: number;
  percentage: number;
  sectionScores: { sectionId: string; sectionTitle: string; score: number; maximumScore: number }[];
  dimensionScores: { id: string; name: string; score: number; responseCount: number }[];
};

function parseResponse(value: string | null): unknown {
  if (!value) return null;
  return JSON.parse(value) as unknown;
}

function sortedIds(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value].sort();
  return null;
}

export function scoreAttempt(questions: ScorableAttemptQuestion[], negativeMarking: boolean): ScoreResult {
  const sections = new Map<string, { sectionId: string; sectionTitle: string; score: number; maximumScore: number }>();
  const dimensions = new Map<string, { id: string; name: string; weightedScore: number; totalWeight: number; responseCount: number }>();
  let technicalScore = 0;
  let maximumScore = 0;

  for (const question of questions) {
    const metadata = JSON.parse(question.metadataSnapshot) as QuestionMetadata;
    const response = parseResponse(question.responseJson);
    if (question.questionType === "LIKERT" || question.questionType === "SITUATIONAL_JUDGMENT") {
      const candidateValue = typeof response === "number"
        ? response
        : typeof response === "string" ? metadata.optionScores?.[response] : undefined;
      const value = typeof candidateValue === "number" && Number.isInteger(candidateValue) &&
        candidateValue >= 1 && candidateValue <= 5 ? candidateValue : null;
      if (value !== null) {
        for (const mapping of metadata.dimensions ?? []) {
          const scoredValue = mapping.reverseScored ? 6 - value : value;
          const dimension = dimensions.get(mapping.id) ?? {
            id: mapping.id, name: mapping.name, weightedScore: 0, totalWeight: 0, responseCount: 0
          };
          dimension.weightedScore += scoredValue * mapping.weight;
          dimension.totalWeight += mapping.weight;
          dimension.responseCount++;
          dimensions.set(mapping.id, dimension);
        }
      }
      continue;
    }

    let section = sections.get(question.sectionId);
    if (!section) {
      section = { sectionId: question.sectionId, sectionTitle: question.sectionTitle, score: 0, maximumScore: 0 };
      sections.set(question.sectionId, section);
    }
    maximumScore += question.marksSnapshot;
    section.maximumScore += question.marksSnapshot;
    const actual = sortedIds(response);
    const expected = [...(metadata.correctOptionIds ?? [])].sort();
    const isCorrect = actual !== null && actual.length === expected.length &&
      actual.every((id, index) => id === expected[index]);
    const itemScore = isCorrect ? question.marksSnapshot : actual && negativeMarking
      ? -question.negativeSnapshot
      : 0;
    technicalScore += itemScore;
    section.score += itemScore;
  }

  return {
    technicalScore,
    maximumScore,
    percentage: maximumScore > 0 ? Math.max(0, (technicalScore / maximumScore) * 100) : 0,
    sectionScores: [...sections.values()],
    dimensionScores: [...dimensions.values()].map(({ id, name, weightedScore, totalWeight, responseCount }) => ({
      id, name, score: totalWeight > 0 ? weightedScore / totalWeight : 0, responseCount
    }))
  };
}
