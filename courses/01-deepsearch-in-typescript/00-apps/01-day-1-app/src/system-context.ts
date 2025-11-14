import type { Message } from "ai";

type SearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
  summary: string;
};

type SearchHistoryEntry = {
  query: string;
  results: SearchResult[];
};

export class SystemContext {
  /**
   * The current step in the loop
   */
  private step = 0;

  /**
   * The message history
   */
  private readonly messages: Message[];

  /**
   * The history of all searches (including scraped content)
   */
  private searchHistory: SearchHistoryEntry[] = [];

  constructor(messages: Message[]) {
    this.messages = messages;
  }

  getMessageHistory(): string {
    return this.messages
      .map((message) => {
        const role = message.role === "user" ? "User" : "Assistant";
        return `<${role}>${message.content}</${role}>`;
      })
      .join("\n\n");
  }

  shouldStop() {
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }

  reportSearch(search: SearchHistoryEntry) {
    this.searchHistory.push(search);
  }

  getSearchHistory(): string {
    return this.searchHistory
      .map((search) =>
        [
          `## Query: "${search.query}"`,
          ...search.results.map((result) =>
            [
              `### ${result.date} - ${result.title}`,
              result.url,
              result.snippet,
              `<summary>`,
              result.summary,
              `</summary>`,
            ].join("\n\n"),
          ),
        ].join("\n\n"),
      )
      .join("\n\n");
  }
}
