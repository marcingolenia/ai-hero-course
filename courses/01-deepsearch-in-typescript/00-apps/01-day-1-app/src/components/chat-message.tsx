import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";

export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts: MessagePart[] | undefined;
  role: string;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolInvocation = ({
  toolInvocation,
}: {
  toolInvocation: MessagePart & { type: "tool-invocation" };
}) => {
  const invocation = toolInvocation.toolInvocation;
  const { state, toolName, args } = invocation;

  return (
    <div className="mb-4 rounded-lg border border-gray-600 bg-gray-700/50 p-3">
      <div className="mb-2 text-sm font-semibold text-gray-300">
        Tool: {toolName}
      </div>
      {state === "partial-call" || state === "call" ? (
        <div className="text-sm text-gray-400">
          <div className="mb-1">
            State: {state === "partial-call" ? "Calling..." : "Called"}
          </div>
          <div className="rounded bg-gray-800 p-2">
            <pre className="text-xs">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        </div>
      ) : state === "result" ? (
        <div className="text-sm text-gray-400">
          <div className="mb-1">Result:</div>
          <div className="rounded bg-gray-800 p-2">
            <pre className="text-xs">
              {JSON.stringify(invocation.result, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  if (!parts || parts.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            if (part.type === "text") {
              return <Markdown key={index}>{part.text}</Markdown>;
            }
            if (part.type === "tool-invocation") {
              return (
                <ToolInvocation
                  key={index}
                  toolInvocation={part}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};
