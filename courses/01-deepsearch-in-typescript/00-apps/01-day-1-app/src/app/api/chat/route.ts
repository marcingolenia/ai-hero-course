import { appendResponseMessages, createDataStreamResponse, streamText } from "ai";
import type { Message } from "ai";
import { z } from "zod";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages, chatId } = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const messagesWithParts = ensureMessageParts(messages);
      const initialTitle = getChatTitle(messagesWithParts);
      const currentChatId = chatId ?? crypto.randomUUID();

      await upsertChat({
        userId: session.user.id,
        chatId: currentChatId,
        title: initialTitle,
        messages: messagesWithParts,
      });

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
        onFinish: async ({ response }) => {
          const updatedMessages = appendResponseMessages({
            messages: messagesWithParts,
            responseMessages: response.messages,
          });
          const updatedMessagesWithParts = ensureMessageParts(updatedMessages);

          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: getChatTitle(updatedMessagesWithParts),
            messages: updatedMessagesWithParts,
          });
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

type MessageParts = NonNullable<Message["parts"]>;
type MessageWithParts = Message & { parts: MessageParts };

const ensureMessageParts = (messages: Message[]): MessageWithParts[] =>
  messages.map((message) => {
    if (message.parts && message.parts.length > 0) {
      return message as MessageWithParts;
    }

    const content = message.content;

    if (typeof content === "string") {
      const parts: MessageParts = [
        {
          type: "text",
          text: content,
        },
      ];
      return {
        ...message,
        parts,
      };
    }

    if (Array.isArray(content)) {
      return {
        ...message,
        parts: content as MessageParts,
      };
    }

    const parts: MessageParts = [];

    return {
      ...message,
      parts,
    };
  });

const getChatTitle = (messages: MessageWithParts[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    const text = message.parts
      .map((part) => {
        if (part.type === "text") {
          return part.text;
        }
        return "";
      })
      .join(" ")
      .trim();

    if (text) {
      return truncateTitle(text);
    }
  }

  return "New Chat";
};

const truncateTitle = (title: string) => {
  const maxLength = 80;

  if (title.length <= maxLength) {
    return title;
  }

  return `${title.slice(0, maxLength - 3)}...`;
};


