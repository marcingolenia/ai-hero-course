import type { Message } from "ai";
import { createDataStreamResponse, appendResponseMessages } from "ai";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { streamFromDeepSearch } from "~/deep-search";
import type { OurMessageAnnotation } from "~/types";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
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

      const annotations: OurMessageAnnotation[] = [];

      const result = await streamFromDeepSearch({
        messages,
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = updatedMessages[updatedMessages.length - 1];
          if (!lastMessage) {
            return;
          }

          // Add the annotations to the last message
          lastMessage.annotations = annotations;

          // Save the complete chat history
          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          await langfuse.flushAsync();
        },
        langfuseTraceId: trace.id,
        writeMessageAnnotation: (annotation) => {
          // Save the annotation in-memory
          annotations.push(annotation);
          // Send it to the client
          dataStream.writeMessageAnnotation(annotation);
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
