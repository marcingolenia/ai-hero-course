import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";
import { useState } from "react";
import { SearchIcon } from "lucide-react";
import type { OurMessageAnnotation, Source } from "~/types";

type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
  annotations: OurMessageAnnotation[];
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
  part,
}: {
  part: Extract<MessagePart, { type: "tool-invocation" }>;
}) => {
  const { toolInvocation } = part;
  const { state, toolName, args } = toolInvocation;

  return (
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-400">Tool:</span>
        <span className="text-sm text-gray-300">{toolName}</span>
      </div>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-400">State:</span>
        <span className="ml-2 text-sm text-gray-300">{state}</span>
      </div>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-400">Arguments:</span>
        <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-sm text-gray-300">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
      {toolInvocation.state === "result" && toolInvocation.result && (
        <div>
          <span className="text-sm font-medium text-gray-400">Result:</span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-sm text-gray-300">
            {JSON.stringify(toolInvocation.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

const Sources = ({ sources }: { sources: Source[] }) => {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sources.map((source, index) => (
        <a
          key={index}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded border border-gray-700 bg-gray-800 p-3 text-left hover:bg-gray-700"
        >
          {source.favicon && (
            <img
              src={source.favicon}
              alt=""
              className="mt-0.5 h-4 w-4 flex-shrink-0"
            />
          )}
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-200">
              {source.title}
            </div>
            <div className="mt-1 text-xs text-gray-400">{source.snippet}</div>
          </div>
        </a>
      ))}
    </div>
  );
};

const ReasoningSteps = ({
  annotations,
}: {
  annotations: OurMessageAnnotation[];
}) => {
  const [openStep, setOpenStep] = useState<number | null>(null);

  if (annotations.length === 0) return null;

  return (
    <div className="mb-4 w-full">
      <ul className="space-y-1">
        {annotations.map((annotation, index) => {
          const isOpen = openStep === index;
          return (
            <li key={index} className="relative">
              <button
                onClick={() => setOpenStep(isOpen ? null : index)}
                className={`min-w-34 flex w-full flex-shrink-0 items-center rounded px-2 py-1 text-left text-sm transition-colors ${
                  isOpen
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"
                }`}
              >
                <span
                  className={`z-10 mr-3 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-500 text-xs font-bold ${
                    isOpen
                      ? "border-blue-400 text-white"
                      : "bg-gray-800 text-gray-300"
                  }`}
                >
                  {index + 1}
                </span>
                {annotation.type === "NEW_ACTION"
                  ? annotation.action.title
                  : "Sources"}
              </button>
              <div className={`${isOpen ? "mt-1" : "hidden"}`}>
                {isOpen && (
                  <div className="px-2 py-1">
                    {annotation.type === "NEW_ACTION" ? (
                      <>
                        <div className="text-sm italic text-gray-400">
                          <Markdown>{annotation.action.reasoning}</Markdown>
                        </div>
                        {annotation.action.type === "continue" && (
                          <div className="mt-2 flex flex-col gap-2 text-sm text-gray-400">
                            <div className="flex items-center gap-2">
                              <SearchIcon className="size-4" />
                              <span>Continuing search...</span>
                            </div>
                            <div className="mt-2 border-l-2 border-gray-700 pl-4">
                              <div className="font-medium text-gray-300">
                                Feedback:
                              </div>
                              <Markdown>{annotation.action.feedback!}</Markdown>
                            </div>
                          </div>
                        )}
                      </>
                    ) : annotation.type === "SOURCES" ? (
                      <Sources
                        sources={
                          annotation.type === "SOURCES"
                            ? annotation.sources
                            : []
                        }
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const ChatMessage = ({
  parts,
  role,
  userName,
  annotations,
}: ChatMessageProps) => {
  const isAI = role === "assistant";

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

        {isAI && <ReasoningSteps annotations={annotations} />}

        <div className="prose prose-invert max-w-none">
          {parts.map((part, index) => {
            if (part.type === "text") {
              return <Markdown key={index}>{part.text}</Markdown>;
            }
            if (part.type === "tool-invocation") {
              return <ToolInvocation key={index} part={part} />;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};
