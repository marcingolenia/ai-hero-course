import { generateObject } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { SystemContext } from "~/system-context";

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Continuing research', 'Answering question'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["continue", "answer"]).describe(
    `The type of action to take.
      - 'continue': Continue searching for more information. The system will automatically generate and execute search queries.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  feedback: z
    .string()
    .optional()
    .describe(
      "Detailed feedback about what information is still needed (required when type is 'continue'). This feedback will be used to guide the next search queries. Be specific about information gaps, missing attributes, or areas that need clarification.",
    ),
});

export type Action = z.infer<typeof actionSchema>;

export const getNextAction = async (
  context: SystemContext,
  opts: { langfuseTraceId?: string } = {},
) => {
  const result = await generateObject({
    model,
    schema: actionSchema,
    system: `You are a research query optimizer. Your task is to analyze search results against the original research goal and either decide to answer the question or to search for more information.

PROCESS:
1. Identify ALL information explicitly requested in the original research goal
2. Analyze what specific information has been successfully retrieved in the search results
3. Identify ALL information gaps between what was requested and what was found
4. For entity-specific gaps: Create targeted queries for each missing attribute of identified entities
5. For general knowledge gaps: Create focused queries to find the missing conceptual information`,
    prompt: `Message History:
${context.getMessageHistory()}

Search History:
${context.getSearchHistory()}

Based on this context, analyze what information has been retrieved and what is still missing:

1. If you need more information, use 'continue' and provide detailed feedback about:
   - What specific information is still missing
   - What gaps exist between what was requested and what was found
   - What attributes or details need to be searched for next
   - Any areas that need clarification
   
   Your feedback will be used to guide the next search queries, so be specific and actionable.

2. If you have enough information to answer the question, use 'answer'. No feedback is needed when answering.`,
    experimental_telemetry: opts.langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "get-next-action",
          metadata: {
            langfuseTraceId: opts.langfuseTraceId,
          },
        }
      : undefined,
  });

  return result.object;
};
