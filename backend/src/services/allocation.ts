export type AllocatableQuestion = {
  id: string;
  text: string;
  type: string;
  marks: number;
  negativeMarks: number;
  options: { id: string; text: string; isCorrect?: boolean | null; scoreValue?: number | null; position: number }[];
  dimensionMappings: {
    dimensionId: string;
    weight: number;
    reverseScored: boolean;
    direction: string;
    dimension: { id: string; name: string };
  }[];
};

export type BlueprintPool = {
  sectionId: string;
  sectionTitle: string;
  requiredCount: number;
  questions: AllocatableQuestion[];
};

export type AllocatedQuestion = {
  question: AllocatableQuestion;
  sectionId: string;
  sectionTitle: string;
};

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function allocateQuestions(pools: BlueprintPool[], random: () => number = Math.random): AllocatedQuestion[] {
  const slots = pools.flatMap((pool) =>
    Array.from({ length: pool.requiredCount }, () => ({
      sectionId: pool.sectionId,
      sectionTitle: pool.sectionTitle,
      candidates: shuffled(pool.questions, random).map((question) => question.id)
    }))
  );
  const questionById = new Map(pools.flatMap((pool) => pool.questions.map((question) => [question.id, question] as const)));
  const assignedSlotByQuestion = new Map<string, number>();
  const assignedQuestionBySlot = new Map<number, string>();

  const assign = (slotIndex: number, visited: Set<string>): boolean => {
    for (const questionId of slots[slotIndex].candidates) {
      if (visited.has(questionId)) continue;
      visited.add(questionId);
      const previousSlot = assignedSlotByQuestion.get(questionId);
      if (previousSlot === undefined || assign(previousSlot, visited)) {
        assignedSlotByQuestion.set(questionId, slotIndex);
        assignedQuestionBySlot.set(slotIndex, questionId);
        return true;
      }
    }
    return false;
  };

  const slotOrder = slots.map((_, index) => index).sort(
    (left, right) => slots[left].candidates.length - slots[right].candidates.length
  );
  for (const slotIndex of slotOrder) {
    if (!assign(slotIndex, new Set())) throw new Error("Blueprint does not have enough distinct eligible questions");
  }

  const result = slots.map((slot, index) => ({
    question: questionById.get(assignedQuestionBySlot.get(index)!)!,
    sectionId: slot.sectionId,
    sectionTitle: slot.sectionTitle
  }));
  return shuffled(result, random);
}
