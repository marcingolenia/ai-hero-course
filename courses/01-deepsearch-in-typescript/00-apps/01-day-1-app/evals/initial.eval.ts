import { data as devData } from "./dev";
import { data as ciData } from "./ci";
import { env } from "~/env";
import { evalite } from "evalite";
import { checkFactuality } from "./scorer";
import { askDeepSearch } from "~/deep-search";

const data = devData;

if (env.EVAL_DATASET === "ci") {
  data.push(...ciData);
} 

evalite("My Eval", {
  data: async () => data,
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