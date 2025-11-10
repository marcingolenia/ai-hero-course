"use client";

import { useChat } from "@ai-sdk/react";
import { Loader2 } from "lucide-react";
import { ChatMessage } from "~/components/chat-message";
import type { FormEvent } from "react";
import { useState } from "react";
import { SignInModal } from "~/components/sign-in-modal";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
}

export const ChatPage = ({ userName, isAuthenticated }: ChatProps) => {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!isAuthenticated) {
      event.preventDefault();
      setIsSignInModalOpen(true);
      return;
    }
    void handleSubmit(event);
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto"
          role="log"
          aria-label="Chat messages"
        >
          {messages.map((message, index) => (
            <ChatMessage
              key={index}
              parts={message.parts}
              role={message.role}
              userName={userName}
            />
          ))}
        </div>
        
        <div className="border-t border-gray-700">
          <form onSubmit={onSubmit} className="mx-auto max-w-[65ch] p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded bg-gray-700 px-4 py-2"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
      <SignInModal
        isOpen={isSignInModalOpen}
        onClose={() => setIsSignInModalOpen(false)}
      />
    </>
  );
};