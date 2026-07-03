export type WebfetchFormat = "markdown" | "text" | "html";
export type WebfetchAction = "fetch" | "render";

export interface WebfetchParams {
	url: string;
	action?: WebfetchAction;
	format?: WebfetchFormat;
	login?: boolean;
	timeout?: number;
}

export interface WebfetchDetails {
	url: string;
	action: WebfetchAction;
	format: WebfetchFormat;
	status: number;
	truncated: boolean;
	originalChars: number;
}
