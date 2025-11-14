import { SystemContext } from "./system-context";
import { getNextAction } from "./get-next-action";
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
    // We choose the next action based on the state of our system
    const nextAction = await getNextAction(ctx, opts);

    // Send the action as an annotation if writeMessageAnnotation is provided
    if (opts.writeMessageAnnotation) {
      opts.writeMessageAnnotation({
        type: "NEW_ACTION",
        action: nextAction,
      });
    }

    // We execute the action and update the state of our system
    if (nextAction.type === "search") {
      if (!nextAction.query) {
        throw new Error("Query is required for search action");
      }
      const query = nextAction.query;
      const results = await searchSerper(
        { q: query, num: 5 },
        undefined,
      );
      
      // Extract URLs from search results
      const urls = results.organic.map((result) => result.link);

      console.log("urls", urls);
      
      // Scrape all URLs from the search results
      const scrapeResults = await bulkCrawlWebsites({ urls });
      
      // Combine search results with scraped content
      const searchResultsWithContent = results.organic.map((result) => {
        // Find the corresponding scrape result for this URL
        const scrapeResult = scrapeResults.results.find((r) => r.url === result.link);
        const scrapedContent = scrapeResult?.result.success
          ? scrapeResult.result.data
          : "";
        
        return {
          date: result.date || new Date().toISOString(),
          title: result.title,
          url: result.link,
          snippet: result.snippet,
          scrapedContent,
        };
      });
      
      // Summarize all URLs in parallel
      const summaries = await Promise.all(
        searchResultsWithContent.map((result) =>
          summarizeURL({
            conversation: ctx.getMessageHistory(),
            scrapedContent: result.scrapedContent,
            searchMetadata: {
              date: result.date,
              title: result.title,
              url: result.url,
            },
            query,
            langfuseTraceId: opts.langfuseTraceId,
          }),
        ),
      );
      
      // Combine search results with summaries
      const searchResults = searchResultsWithContent.map((result, index) => ({
        date: result.date,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        summary: summaries[index] || "",
      }));
      
      ctx.reportSearch({
        query,
        results: searchResults,
      });
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false, ...opts });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and haven't answered yet,
  // we ask the LLM to give its best attempt at an answer
  return answerQuestion(ctx, { isFinal: true, ...opts });
}
