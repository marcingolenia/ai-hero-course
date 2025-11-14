import { SystemContext } from "./system-context";
import { getNextAction } from "./get-next-action";
import { queryRewriter } from "./query-rewriter";
import { searchSerper } from "./serper";
import { bulkCrawlWebsites } from "~/scraper";
import { streamText, type StreamTextResult, type Message } from "ai";
import { answerQuestion } from "./answer-question";
import type { OurMessageAnnotation } from "~/types";
import { summarizeURL } from "./summarize-url";

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


  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    // 1. Get the plan and queries
    const { plan, queries } = await queryRewriter(ctx, opts);

    // 2. Execute all queries in parallel
    const searchResultsPromises = queries.map(async (query) => {
      // 1. Search the web
      const searchResults = await searchSerper(
        { q: query, num: 5 }, // Reduced from 10 to 5 results per query
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
            langfuseTraceId: opts.langfuseTraceId,
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
