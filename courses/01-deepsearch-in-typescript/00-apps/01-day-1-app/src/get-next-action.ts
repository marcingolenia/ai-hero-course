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
});

export type Action = z.infer<typeof actionSchema>;

export const getNextAction = async (
  context: SystemContext,
  opts: { langfuseTraceId?: string } = {},
) => {
  const result = await generateObject({
    model,
    schema: actionSchema,
    system: `
    You are a helpful AI assistant that can search the web or answer questions. Your goal is to determine whether you have enough information to answer the user's question, or if you need to continue searching.
    `,
    prompt: `Message History:
${context.getMessageHistory()}

Based on this context, choose the next action:
1. If you need more information, use 'continue' - the system will automatically generate and execute search queries
2. If you have enough information to answer the question, use 'answer'

Remember:
- Only use 'continue' if you need more information to provide a complete answer
- Use 'answer' when you have enough information to provide a complete answer
- The system will automatically handle query generation and searching when you choose 'continue'

Here is the search history:

${context.getSearchHistory()}
`,
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
