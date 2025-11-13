import {
  streamText,
  type Message,
  type TelemetrySettings,
} from "ai";
import { z } from "zod";
import { model } from "~/model";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { cacheWithRedis } from "~/server/redis/redis";

const getCurrentDate = () => {
  return new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "short",
  });
};

export const streamFromDeepSearch = (opts: {
  messages: Message[];
  onFinish: Parameters<
    typeof streamText
  >[0]["onFinish"];
  telemetry: TelemetrySettings;
}) =>
  streamText({
    model,
    messages: opts.messages,
    maxSteps: 10,
    system: `You are a helpful AI assistant with access to real-time web search capabilities. 

CURRENT DATE AND TIME: ${getCurrentDate()}

Before you answer the question, you should devise a plan to answer the question. Your plan should be a list of steps.
You should then execute the plan by calling the tools available to you and updating your plan as you go. The last step should be to answer the question and ALWAYS providing links to the sources you used to answer the question.

1. Include at least one markdown link in your response to the source of the information. Ideally add links to all the sources you used to answer the question.
2. When users ask for "up to date", "latest", "current", or "recent" information, pay close attention to the publication dates in search results. Use the current date (${getCurrentDate()}) to determine how recent the information is and prioritize the most recent sources.
3. Be thorough but concise in your responses`,
    tools: {
      searchWeb: {
        description: "Search the web for current information. Returns search results with titles, links, and snippets. After getting results, you MUST immediately call scrapePages with the 'link' values from the results.",
        parameters: z.object({
          query: z.string().describe("The query to search the web for"),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: 10 },
            abortSignal,
          );

          return results.organic.map((result) => ({
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            date: result.date,
          }));
        },
      },
      scrapePages: {
        description: "Extract the full text content from web pages. You MUST use this tool after getting search results to get complete information from the pages. Do not rely on snippets alone - always scrape the full pages.",
        parameters: z.object({
          urls: z.array(z.string()).describe("The URLs from search results that you want to scrape for full content. Extract the 'link' field from each search result."),
        }),
        execute: cacheWithRedis(
          "scrapePages",
          async ({ urls }: { urls: string[] }) => {
            const crawlResult = await bulkCrawlWebsites({ urls });

            if (!crawlResult.success) {
              // Return error information to the LLM
              return {
                success: false,
                error: crawlResult.error,
                results: crawlResult.results.map((r) => ({
                  url: r.url,
                  success: r.result.success,
                  data: r.result.success ? r.result.data : undefined,
                  error: r.result.success ? undefined : r.result.error,
                })),
              };
            }

            return {
              success: true,
              results: crawlResult.results.map((r) => ({
                url: r.url,
                data: r.result.data,
              })),
            };
          },
        ),
      },
    },
    onFinish: opts.onFinish,
    experimental_telemetry: opts.telemetry,
  });

export async function askDeepSearch(
  messages: Message[],
) {
  const result = streamFromDeepSearch({
    messages,
    onFinish: () => {}, // just a stub
    telemetry: {
      isEnabled: false,
    },
  });

  // Consume the stream - without this,
  // the stream will never finish
  await result.consumeStream();

  return await result.text;
}

