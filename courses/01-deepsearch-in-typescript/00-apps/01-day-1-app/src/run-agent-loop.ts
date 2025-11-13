import { SystemContext } from "./system-context";
import { getNextAction } from "./get-next-action";
import { searchSerper } from "./serper";
import { bulkCrawlWebsites } from "./scraper";
import { answerQuestion } from "./answer-question";

async function search(ctx: SystemContext, query: string) {
  const results = await searchSerper(
    { q: query, num: 10 },
    undefined,
  );

  const queryResult = {
    query,
    results: results.organic.map((result) => ({
      date: result.date || "",
      title: result.title,
      url: result.link,
      snippet: result.snippet,
    })),
  };

  ctx.reportQueries([queryResult]);

  return queryResult;
}

async function scrapeUrl(ctx: SystemContext, urls: string[]) {
  const crawlResult = await bulkCrawlWebsites({ urls });

  const scrapeResults = crawlResult.results.map((r) => ({
    url: r.url,
    result: r.result.success
      ? r.result.data
      : `Error: ${r.result.error}`,
  }));

  ctx.reportScrapes(scrapeResults);

  return scrapeResults;
}

export async function runAgentLoop(userQuestion: string) {
  const ctx = new SystemContext();

  while (!ctx.shouldStop()) {
    const nextAction = await getNextAction(ctx);

    if (nextAction.type === "search") {
      if (!nextAction.query) {
        throw new Error("Search action requires a query");
      }
      await search(ctx, nextAction.query);
    } else if (nextAction.type === "scrape") {
      if (!nextAction.urls || nextAction.urls.length === 0) {
        throw new Error("Scrape action requires URLs");
      }
      await scrapeUrl(ctx, nextAction.urls);
    } else if (nextAction.type === "answer") {
      return await answerQuestion(ctx, userQuestion, { isFinal: false });
    }

    ctx.incrementStep();
  }

  return await answerQuestion(ctx, userQuestion, { isFinal: true });
}

