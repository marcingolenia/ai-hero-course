import { appendResponseMessages, createDataStreamResponse, streamText } from "ai";
import type { Message } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { cacheWithRedis } from "~/server/redis/redis";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { chats } from "~/server/db/schema";
import { db } from "~/server/db";
import { eq } from "drizzle-orm";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  const { messages, chatId } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  // If no chatId is provided, create a new chat with the user's message
  let currentChatId = chatId;
  if (!currentChatId) {
    const newChatId = crypto.randomUUID();
    await upsertChat({
      userId: session.user.id,
      chatId: newChatId,
      title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
      messages: messages, // Only save the user's message initially
    });
    currentChatId = newChatId;
  } else {
    // Verify the chat belongs to the user
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });
    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  const trace = langfuse.trace({
    sessionId: currentChatId,
    name: "chat",
    userId: session.user.id,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // If this is a new chat, send the chat ID to the frontend
      if (!chatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: currentChatId,
        });
      }

      const currentDate = new Date().toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        timeZoneName: "short",
      });

      const result = streamText({
        model,
        messages,
        maxSteps: 10,
        system: `You are a helpful AI assistant with access to real-time web search capabilities. 

CURRENT DATE AND TIME: ${currentDate}

When answering questions:

1. Always search the web for up-to-date information when relevant and use scrapePages tool to extract the content.
2. When users ask for "up to date", "latest", "current", or "recent" information, pay close attention to the publication dates in search results. Use the current date (${currentDate}) to determine how recent the information is and prioritize the most recent sources.
3. Be thorough but concise in your responses
4. Never include raw URLs - always use markdown link format

WORKFLOW - YOU MUST FOLLOW THIS EXACTLY:
Step 1: Use searchWeb tool to find relevant information
Step 2: IMMEDIATELY after getting search results, extract the 'link' field from each result and call scrapePages with those URLs
Step 3: Use the full scraped content (not snippets) to provide your answer`,
        experimental_telemetry: { 
          isEnabled: true,
          functionId: 'agent',
          metadata: {
            langfuseTraceId: trace.id
          }
        },
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
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            return;
          }

          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          await langfuse.flushAsync();
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}