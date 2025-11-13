import { generateText } from "ai";
import { model } from "./model";
import type { SystemContext } from "./system-context";

export async function answerQuestion(
  ctx: SystemContext,
  userQuestion: string,
  opts: { isFinal: boolean } = { isFinal: false },
) {
  const systemPrompt = opts.isFinal
    ? `You are a helpful AI assistant. The user has asked a question, and we have gathered some information through web searches and URL scraping. However, we may not have all the information we need to fully answer the question. Please provide your best attempt at answering the question based on the available information. If you don't have enough information, be honest about what you know and what you don't know.`
    : `You are a helpful AI assistant. The user has asked a question, and we have gathered information through web searches and URL scraping. Based on the information gathered, provide a comprehensive and accurate answer to the user's question.`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `User Question: ${userQuestion}

Here is the information we have gathered:

${ctx.getQueryHistory()}

${ctx.getScrapeHistory()}

Please provide a comprehensive answer to the user's question based on the information above.`,
  });

  return result.text;
}

