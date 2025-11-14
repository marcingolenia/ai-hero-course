import type { Action } from "./get-next-action";

export type Source = {
	title: string;
	url: string;
	snippet: string;
	favicon?: string;
};


export type OurMessageAnnotation =
	| {
			type: "NEW_ACTION";
			action: Action;
	  }
	| {
			type: "SOURCES";
			sources: Source[];
	  };