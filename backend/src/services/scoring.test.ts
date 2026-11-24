import { describe, expect, it } from "vitest";
import { allocateQuestions } from "./allocation";
import { scoreAttempt } from "./scoring";

describe("assessment engine", () => {
  it("allocates every quota without duplicates even when pools overlap", () => {
    const question = (id: string) => ({
      id, text: id, type: "SINGLE_CHOICE", marks: 1, negativeMarks: 0,
      options: [], dimensionMappings: []
    });
    const allocated = allocateQuestions([
      { sectionId: "a", sectionTitle: "A", requiredCount: 2, questions: [question("1"), question("2"), question("3")] },
      { sectionId: "b", sectionTitle: "B", requiredCount: 2, questions: [question("1"), question("2"), question("3"), question("4")] }
    ], () => 0.4);
    expect(allocated).toHaveLength(4);
    expect(new Set(allocated.map(({ question: item }) => item.id)).size).toBe(4);
  });

  it("rejects a blueprint when distinct eligible questions are insufficient", () => {
    const question = { id: "1", text: "Q", type: "SINGLE_CHOICE", marks: 1, negativeMarks: 0, options: [], dimensionMappings: [] };
    expect(() => allocateQuestions([
      { sectionId: "a", sectionTitle: "A", requiredCount: 1, questions: [question] },
      { sectionId: "b", sectionTitle: "B", requiredCount: 1, questions: [question] }
    ])).toThrow(/distinct eligible questions/);
  });

  it("scores objective answers, negative marks and reverse-scored dimensions", () => {
    const result = scoreAttempt([
      {
        sectionId: "s", sectionTitle: "SQL", questionType: "SINGLE_CHOICE", marksSnapshot: 2,
        negativeSnapshot: 0.5, metadataSnapshot: JSON.stringify({ correctOptionIds: ["right"] }),
        responseJson: JSON.stringify("right")
      },
      {
        sectionId: "s", sectionTitle: "SQL", questionType: "SINGLE_CHOICE", marksSnapshot: 2,
        negativeSnapshot: 0.5, metadataSnapshot: JSON.stringify({ correctOptionIds: ["other"] }),
        responseJson: JSON.stringify("wrong")
      },
      {
        sectionId: "p", sectionTitle: "Profile", questionType: "LIKERT", marksSnapshot: 0,
        negativeSnapshot: 0, metadataSnapshot: JSON.stringify({
          dimensions: [{ id: "d", name: "Adaptability", weight: 2, reverseScored: true }]
        }), responseJson: JSON.stringify(2)
      }
    ], true);
    expect(result.technicalScore).toBe(1.5);
    expect(result.maximumScore).toBe(4);
    expect(result.sectionScores[0].score).toBe(1.5);
    expect(result.dimensionScores[0].score).toBe(4);
  });
});
