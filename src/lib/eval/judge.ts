import { z } from "zod";
import { geminiObject } from "@/lib/gemini/client";

const Verdict = z.object({
  faithfulness: z.number().min(0).max(1).describe("fraction of the answer's factual claims directly supported by the sources shown; 1 when every claim is supported or the answer is a refusal"),
  correctness: z.union([z.literal(0), z.literal(0.5), z.literal(1)]).describe("1 = conveys the expected answer's key facts; 0.5 = partially; 0 = wrong, mixed up with another region/chapter, or missing the key fact"),
  mixedUp: z.boolean().describe("true when the answer states a figure or claim that belongs to a different region, country, chapter or year than the question asks about"),
  unsupportedClaims: z.array(z.string()),
  note: z.string().describe("one sentence"),
});
export type Verdict = z.infer<typeof Verdict>;

/**
 * LLM-as-judge (reused from rag-chatbot, plus a mix-up flag). Gemini grading Gemini is a known bias; the golden
 * set's human-written expected answers and numbers anchor `correctness`, and retrieval metrics need no judge.
 */
export async function judge(question: string, answer: string, expected: string, numbers: string[], sources: string[]): Promise<Verdict> {
  return geminiObject(
    "judge",
    Verdict,
    [{ type: "text", text: `Question: ${question}\n\nSources the assistant was given:\n${sources.map((s, i) => `[${i + 1}] ${s.slice(0, 3000)}`).join("\n\n")}\n\nAssistant's answer:\n${answer}\n\nHuman-written expected answer:\n${expected}\nKey numbers: ${numbers.join(", ") || "(none)"}` }],
    "You grade an assistant that answers questions about the World Bank's Global Economic Prospects (June 2026). Faithfulness: is each claim supported by the sources shown (not your own knowledge)? Correctness compares with the expected answer: 1 when the key facts and numbers the question asks for match; 0.5 when a key fact is missing or imprecise; 0 when wrong, refused while an expected answer exists, or when it mixes in figures from another region or chapter. Do not deduct for omitting secondary details. A refusal is faithful; it is correct only if the expected answer is also a refusal.",
  );
}
