import { appendResponseMessages, createDataStreamResponse } from "ai";
import type { Message } from "ai";
import { auth } from "~/server/auth";
import { upsertChat } from "~/server/db/queries";
import { streamFromDeepSearch } from "~/deep-search";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { chats } from "~/server/db/schema";
import { db } from "~/server/db";
import { eq } from "drizzle-orm";
import { checkRateLimit, recordRateLimit, type RateLimitConfig } from "~/server/rateLimit";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

const config: RateLimitConfig = {
  maxRequests: 15,
  maxRetries: 3,
  windowMs: 60_000,
  keyPrefix: "global",
};

export async function POST(request: Request) {
// Check the rate limit
const rateLimitCheck = await checkRateLimit(config);
console.log("Rate limit check:", rateLimitCheck);

if (!rateLimitCheck.allowed) {
  console.log("Rate limit exceeded, waiting...");
  const isAllowed = await rateLimitCheck.retry();
  // If the rate limit is still exceeded, return a 429
  if (!isAllowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
    });
  }
}
await recordRateLimit(config);
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

  // Create trace before any database calls
  const trace = langfuse.trace({
    name: "chat",
    userId: session.user.id,
  });

  // If no chatId is provided, create a new chat with the user's message
  let currentChatId = chatId;
  if (!currentChatId) {
    const newChatId = crypto.randomUUID();
    const createChatSpan = trace.span({
      name: "create-chat",
      input: {
        userId: session.user.id,
        chatId: newChatId,
        title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
        messageCount: messages.length,
      },
    });
    
    await upsertChat({
      userId: session.user.id,
      chatId: newChatId,
      title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
      messages: messages, // Only save the user's message initially
    });
    
    createChatSpan.end({
      output: {
        chatId: newChatId,
      },
    });
    
    currentChatId = newChatId;
  } else {
    // Verify the chat belongs to the user
    const verifyChatSpan = trace.span({
      name: "verify-chat",
      input: {
        chatId: currentChatId,
        userId: session.user.id,
      },
    });
    
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });
    
    if (!chat || chat.userId !== session.user.id) {
      verifyChatSpan.end({
        output: {
          authorized: false,
        },
      });
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
    
    verifyChatSpan.end({
      output: {
        authorized: true,
        chatId: chat.id,
        userId: chat.userId,
      },
    });
  }

  // Update trace with sessionId now that we have currentChatId
  trace.update({
    sessionId: currentChatId,
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

      const result = streamFromDeepSearch({
        messages,
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

          const updateChatSpan = trace.span({
            name: "update-chat",
            input: {
              userId: session.user.id,
              chatId: currentChatId,
              title: lastMessage.content.slice(0, 50) + "...",
              messageCount: updatedMessages.length,
            },
          });

          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          updateChatSpan.end({
            output: {
              chatId: currentChatId,
              messageCount: updatedMessages.length,
            },
          });

          await langfuse.flushAsync();
        },
        telemetry: { 
          isEnabled: true,
          functionId: 'agent',
          metadata: {
            langfuseTraceId: trace.id
          }
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