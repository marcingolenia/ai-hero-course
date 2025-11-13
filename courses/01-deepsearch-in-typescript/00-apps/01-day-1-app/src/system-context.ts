import { z } from "zod";
import { generateObject } from "ai";
import { model } from "./model";


export interface SearchAction {
    type: "search";
    query: string;
  }
  
  export interface ScrapeAction {
    type: "scrape";
    urls: string[];
  }
  
  export interface AnswerAction {
    type: "answer";
  }
  
  export type Action =
    | SearchAction
    | ScrapeAction
    | AnswerAction;


export const actionSchema = z.object({
    type: z
    .enum(["search", "scrape", "answer"])
    .describe(
        `The type of action to take.
        - 'search': Search the web for more information.
        - 'scrape': Scrape a URL.
        - 'answer': Answer the user's question and complete the loop.`,
    ),
    query: z
    .string()
    .describe(
        "The query to search for. Required if type is 'search'.",
    )
    .optional(),
    urls: z
    .array(z.string())
    .describe(
        "The URLs to scrape. Required if type is 'scrape'.",
    )
    .optional(),
});


export const getNextAction = async (
    context: SystemContext,
  ) => {
    const result = await generateObject({
      model,
      schema: actionSchema,
      prompt: `
  You are a helpful assistant that can search the web, scrape a URL, or answer the user's question.
  
  Here is the context:
  
  ${context.getQueryHistory()}
  
  ${context.getScrapeHistory()}
      `,
    });
  
    return result.object;
  };


type QueryResultSearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
};

type QueryResult = {
  query: string;
  results: QueryResultSearchResult[];
};

type ScrapeResult = {
  url: string;
  result: string;
};

const toQueryResult = (query: QueryResultSearchResult) =>
  [`### ${query.date} - ${query.title}`, query.url, query.snippet].join(
    "\n\n",
  );

export class SystemContext {
  /**
   * The current step in the loop
   */
  private step = 0;

  /**
   * The history of all queries searched
   */
  private queryHistory: QueryResult[] = [];

  /**
   * The history of all URLs scraped
   */
  private scrapeHistory: ScrapeResult[] = [];

  shouldStop() {
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }

  reportQueries(queries: QueryResult[]) {
    this.queryHistory.push(...queries);
  }

  reportScrapes(scrapes: ScrapeResult[]) {
    this.scrapeHistory.push(...scrapes);
  }

  getQueryHistory(): string {
    return this.queryHistory
      .map((query) =>
        [
          `## Query: "${query.query}"`,
          ...query.results.map(toQueryResult),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  getScrapeHistory(): string {
    return this.scrapeHistory
      .map((scrape) =>
        [
          `## Scrape: "${scrape.url}"`,
          `<scrape_result>`,
          scrape.result,
          `</scrape_result>`,
        ].join("\n\n"),
      )
      .join("\n\n");
  }
}

