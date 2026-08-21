export type SourceNoteLoadResult =
	| { status: 'ready'; filePath: string; markdown: string }
	| { status: 'missing'; filePath: string; message: string }
	| { status: 'error'; filePath: string; message: string };

export async function loadSourceNote(
	filePath: string,
	readSourceFile: (filePath: string) => Promise<string | undefined>,
): Promise<SourceNoteLoadResult> {
	try {
		const markdown = await readSourceFile(filePath);
		return markdown === undefined
			? {
				status: 'missing',
				filePath,
				message: 'The original source note is missing or is no longer a Markdown file.',
			}
			: { status: 'ready', filePath, markdown };
	} catch (error) {
		console.error('TTRPG Card Forge: could not read source note', error);
		return {
			status: 'error',
			filePath,
			message: 'The original source note could not be read. See the developer console.',
		};
	}
}
