import type { Message } from "ai";
import { streamText, createDataStreamResponse } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

      const result = streamText({
        // Cast to satisfy current AI SDK typings across versions
        model: model,
        messages,
        maxSteps: 10,
        system: [
          "You are an AI assistant with access to a real-time web search tool.",
          "Always call the `searchWeb` tool at least once before finalizing any answer.",
          "Cite every factual statement with inline markdown links to the sources you retrieved.",
          "Never output bare URLs. Wrap every citation in `[descriptive text](https://example.com)` form, using the result title (or a concise summary you write) for the descriptive text.",
          "If you cannot access the tool or find relevant information, explain the limitation before responding.",
        ].join("\n"),
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper({ q: query, num: 10 }, abortSignal);

              return results.organic.map((result) => ({
                title: result.title,
                link: result.link,
                snippet: result.snippet,
              }));
            },
          },
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}


