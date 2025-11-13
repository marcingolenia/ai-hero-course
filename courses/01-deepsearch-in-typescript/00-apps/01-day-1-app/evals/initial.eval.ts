import { evalite } from "evalite";
import { askDeepSearch } from "~/deep-search";
import { checkFactuality } from "./scorer";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    return [
      {
        input: "What is the latest version of TypeScript?",
        expected: "The latest version of TypeScript is 5.9.3",
      },
      {
        input: "What are the main features of Next.js 15?",
        expected: `
React 19 Support: Full support for React 19, including new hooks like useActionState, useFormStatus, and useOptimistic, plus experimental React Compiler support.
Caching Changes: fetch requests and GET Route Handlers are no longer cached by default. Client Router Cache no longer caches Page components by default.
Async Request APIs: Request-specific APIs like headers, cookies, params, and searchParams are now asynchronous.
<Form> Component: A new <Form> component extends the HTML <form> element with prefetching, client-side navigation, and progressive enhancement.
Turbopack Stable: Turbopack is now stable for development, offering faster local server startup and code updates. Turbopack for builds is in alpha.
Static Route Indicator: A visual indicator during development shows static routes.
after API: New API (stable) to execute code after a response has finished streaming (previously unstable_after).
instrumentation.js Stable: New API for server lifecycle observability.
next.config.ts Support: TypeScript support for next.config.ts.
ESLint 9 Support: Added support for ESLint 9.
Navigation hooks: Control routing with onNavigate and useLinkStatus.
Improved Error Debugging: Enhanced DX and better source maps for the browser and the terminal.
forbidden / unauthorized (experimental): New APIs to enable more granular authentication error handling.
`,
      },
    ];
  },
  task: async (input) => {
    return askDeepSearch([{
      id: "1",
      role: "user",
      content: input,
    }]);
  },
  scorers: [
    {
      name: "Contains Links",
      description:
        "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // todo test if output caontains at least once markdown link
        const markdownLinkRegex = /\[.*?\]\(.*?\)/g;
        const containsLinks = markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0;
      },
    },
    {
      name: "Factuality",
      description: "Checks if the output is factual.",
      scorer: ({ output, input, expected }) => {
        return checkFactuality({
          question: input,
          groundTruth: expected!,
          submission: output,
        });
      },
    },
  ],
});