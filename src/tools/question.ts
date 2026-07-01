import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { QuestionBridge, QuestionData } from "./question-bridge.js";

export interface QuestionDetails {
	answers: string[][];
}

const QuestionOptionSchema = Type.Object({
	label: Type.String({ description: "Short display text for the option" }),
	description: Type.String({ description: "Explanation of what this option means" }),
});

const QuestionItemSchema = Type.Object({
	question: Type.String({ description: "The complete question to ask the user" }),
	header: Type.String({ description: "Very short label (max 30 chars)", maxLength: 30 }),
	options: Type.Array(QuestionOptionSchema, {
		description: "Available options. A custom-input option is always added automatically.",
	}),
	multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options" })),
});

const QuestionParams = Type.Object({
	questions: Type.Array(QuestionItemSchema, {
		description: "Questions to ask the user. Each is answered separately.",
	}),
});

const DESCRIPTION = [
	"Ask the user structured questions to clarify intent, confirm decisions, or gather preferences.",
	"Each question has a short header, full question text, and selectable options.",
	"Use this tool when you need user input before proceeding — never guess or assume.",
	"A custom free-text input option is always available in addition to the provided options.",
].join(" ");

export function createQuestionTool(bridge?: QuestionBridge): ToolDefinition {
	return {
		name: "question",
		label: "Question",
		description: DESCRIPTION,
		promptSnippet: "question — ask user for structured input",
		parameters: QuestionParams,
		async execute(_toolCallId, params, signal) {
			const p = params as QuestionData;

			if (!bridge) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Question tool is not available in non-interactive mode.",
						},
					],
					details: { answers: [] } as QuestionDetails,
				};
			}

			const answers = await new Promise<string[][]>((resolve, reject) => {
				bridge.pending = p;
				bridge.resolve = resolve;
				bridge.reject = reject;

				if (signal) {
					signal.addEventListener(
						"abort",
						() => {
							bridge.pending = null;
							bridge.resolve = null;
							bridge.reject = null;
							reject(signal.reason ?? new Error("Aborted"));
						},
						{ once: true },
					);
				}
			});

			bridge.pending = null;
			bridge.resolve = null;
			bridge.reject = null;

			const summary = answers
				.map((a, i) => `${p.questions[i]?.header ?? `Q${i + 1}`}: ${a.join(", ") || "Unanswered"}`)
				.join("\n");

			return {
				content: [{ type: "text" as const, text: summary }],
				details: { answers } as QuestionDetails,
			};
		},
	};
}
