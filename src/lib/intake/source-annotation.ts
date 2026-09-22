import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const lines = z.array(text(2000)).max(12);
export const sourceAnnotationSchema = z.object({
  sourceFactIds: z.array(z.uuid()).min(1).max(20),
  annotation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("EMPLOYMENT"), historicalTitle: text(200), employer: text(200), dates: text(200),
      bullets: lines.min(1), coverLetterEvidence: lines }).strict(),
    z.object({ kind: z.literal("RESPONSIBILITY"), activity: text(500), employmentFactId: z.uuid().optional(), coverLetterEvidence: lines }).strict(),
    z.object({ kind: z.literal("EDUCATION"), educationLevel: text(120), educationField: text(200), completionStatus: text(120) }).strict(),
    z.object({ kind: z.literal("TOOL_CAPABILITY"), taskOrTool: text(200), capabilityStatus: z.enum(["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"]) }).strict(),
  ]),
}).strict();

export function annotationDisplay(annotation: z.infer<typeof sourceAnnotationSchema>["annotation"]) {
  return Object.entries(annotation).filter(([key]) => !["kind", "employmentFactId"].includes(key))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("; ") : value}`).join("\n");
}
