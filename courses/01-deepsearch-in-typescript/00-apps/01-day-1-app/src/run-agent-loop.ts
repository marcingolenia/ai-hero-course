import { SystemContext } from "./system-context.ts";
import { getNextAction } from "./get-next-action.ts";
import { searchSerper } from "./serper.ts";
import { bulkCrawlWebsites } from "~/scraper.ts";
import { streamText, type StreamTextResult, type Message } from "ai";
import { model } from "~/model";
import { answerQuestion } from "./answer-question.ts";
import type { OurMessageAnnotation } from "./types.ts";
import { summarizeURL } from "./summarize-url.ts";
import { queryRewriter } from "./query-rewriter.ts";
import { checkIfQuestionNeedsClarification } from "./check-question-clarity.ts";

export async function runAgentLoop(
  messages: Message[],
  opts: {
    langfuseTraceId?: string;
    writeMessageAnnotation?: (annotation: OurMessageAnnotation) => void;
    onFinish: Parameters<typeof streamText>[0]["onFinish"];
  },
): Promise<StreamTextResult<{}, string>> {
  // A persistent container for the state of our system
  const ctx = new SystemContext(messages);

  // Check if the question needs clarification before entering the query loop
  const clarificationResult = await checkIfQuestionNeedsClarification(
    ctx,
    opts,
  );

  if (clarificationResult.needsClarification) {
    return streamText({
      model,
      system: `You are a clarification agent.
Your job is to ask the user for clarification on their question.`,
      prompt: `Here is the message history:

${ctx.getMessageHistory()}

And here is why the question needs clarification:

${clarificationResult.reason || "The question is unclear or ambiguous."}

Please reply to the user with a clarification request.`,
      experimental_telemetry: opts.langfuseTraceId
        ? {
            isEnabled: true,
            functionId: "clarification-response",
            metadata: {
              langfuseTraceId: opts.langfuseTraceId,
            },
          }
        : undefined,
      onFinish: opts.onFinish,
    });
  }

  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    // 1. Get the plan and queries
    const { plan, queries } = await queryRewriter(ctx, opts);

    // 2. Execute all queries in parallel
    const searchResultsPromises = queries.map(async (query) => {
      // 1. Search the web
      const searchResults = await searchSerper(
        { q: query, num: 3 }, // Reduced from 10 to 5 results per query
        undefined,
      );

      return {
        query,
        results: searchResults.organic,
      };
    });

    // 3. Wait for all search results
    const allSearchResults = await Promise.all(searchResultsPromises);

    // 4. Deduplicate sources by URL
    const uniqueSources = Array.from(
      new Map(
        allSearchResults
          .flatMap((sr) => sr.results)
          .map((result) => [
            result.link,
            {
              title: result.title,
              url: result.link,
              snippet: result.snippet,
              favicon: `https://www.google.com/s2/favicons?domain=${new URL(result.link).hostname}`,
            },
          ]),
      ).values(),
    );

    // 5. Send unique sources to frontend
    if (opts.writeMessageAnnotation) {
      opts.writeMessageAnnotation({
        type: "SOURCES",
        sources: uniqueSources,
      });
    }

    // 6. Process each query's results
    const processPromises = allSearchResults.map(async ({ query, results }) => {
      const searchResultUrls = results.map((r) => r.link);

      // Scrape the results
      const crawlResults = await bulkCrawlWebsites({ urls: searchResultUrls });

      // Summarize each scraped result in parallel
      const summaries = await Promise.all(
        results.map(async (result) => {
          const crawlData = crawlResults.success
            ? crawlResults.results.find((cr) => cr.url === result.link)
            : undefined;

          const scrapedContent = crawlData?.result.success
            ? crawlData.result.data
            : "Failed to scrape.";

          if (scrapedContent === "Failed to scrape.") {
            return {
              ...result,
              summary: "Failed to scrape, so no summary could be generated.",
            };
          }

          const summary = await summarizeURL({
            conversation: ctx.getMessageHistory(),
            scrapedContent,
            searchMetadata: {
              date: result.date || new Date().toISOString(),
              title: result.title,
              url: result.link,
            },
            query,
            langfuseTraceId: opts.langfuseTraceId
          });

          return {
            ...result,
            summary,
          };
        }),
      );

      // Report the summaries to the system context
      ctx.reportSearch({
        query,
        results: summaries.map((summaryResult) => ({
          date: summaryResult.date || new Date().toISOString(),
          title: summaryResult.title,
          url: summaryResult.link,
          snippet: summaryResult.snippet,
          summary: summaryResult.summary,
        })),
      });
    });

    // 7. Wait for all processing to complete
    await Promise.all(processPromises);

    // 8. Decide whether to continue or answer
    const nextAction = await getNextAction(ctx, opts);

    // Store the feedback in the system context only if it exists
    if (nextAction.feedback) {
      ctx.setLastFeedback(nextAction.feedback);
    }

    // Send the action as an annotation if writeMessageAnnotation is provided
    if (opts.writeMessageAnnotation) {
      opts.writeMessageAnnotation({
        type: "NEW_ACTION",
        action: nextAction,
      });
    }

    if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false, ...opts });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and haven't answered yet,
  // we ask the LLM to give its best attempt at an answer
  return answerQuestion(ctx, { isFinal: true, ...opts });
}
