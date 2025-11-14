import { generateObject } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { SystemContext } from "~/system-context";

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Searching Saka's injury history', 'Checking HMRC industrial action', 'Comparing toaster ovens'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z.enum(["search", "answer"]).describe(
    `The type of action to take.
      - 'search': Search the web for more information. This will automatically scrape the URLs from the search results.
      - 'answer': Answer the user's question and complete the loop.`,
  ),
  query: z
    .string()
    .describe("The query to search for. Only required if type is 'search'.")
    .optional(),
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
    You are a helpful AI assistant that can search the web or answer questions. Your goal is to determine the next best action to take based on the current context.
    
    When you use 'search', the system will automatically scrape the URLs from the search results, so you don't need to worry about scraping separately.
    `,
    prompt: `Message History:
${context.getMessageHistory()}

Based on this context, choose the next action:
1. If you need more information, use 'search' with a relevant query (this will automatically scrape the URLs from the search results)
2. If you have enough information to answer the question, use 'answer'

Remember:
- Only use 'search' if you need more information
- Use 'answer' when you have enough information to provide a complete answer
- The search action will automatically scrape URLs, so you don't need a separate scrape action

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
