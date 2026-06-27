/**
 * Split streaming text into settled head + trailing tail.
 * Adapted from opencode's splitStreamingMarkdown.
 *
 * When the last block is an unclosed fenced code block,
 * the head (stable markdown) stays still while only the
 * tail (growing code) re-renders — eliminating flicker.
 */
export interface StreamingSplit {
	head: string;
	tail?: string;
}

export function splitStreamingText(text: string): StreamingSplit {
	const lines = text.split("\n");
	let openFence: { byteOffset: number; char: string; len: number } | undefined;
	let byteOffset = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!openFence) {
			const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
			if (match) {
				const mark = match[1];
				if (mark) {
					openFence = { byteOffset, char: mark[0] ?? "`", len: mark.length };
				}
			}
		} else {
			const close = new RegExp(`^[\\t ]{0,3}${openFence.char}{${openFence.len},}[\\t ]*$`);
			if (close.test(line)) {
				openFence = undefined;
			}
		}
		byteOffset += line.length + 1; // +1 for the \n
	}

	if (!openFence) return { head: text };

	const head = text.slice(0, openFence.byteOffset);
	const tail = text.slice(openFence.byteOffset);
	return { head, tail };
}
