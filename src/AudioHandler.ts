import axios from "axios";
import Whisper from "main";
import { Notice, MarkdownView } from "obsidian";
import {
	getBaseFileName,
	getCursorContext,
	buildTemplateVariables,
	resolveTemplate,
} from "./utils";
import { PostProcessor } from "./PostProcessor";
import {
	probeAudio,
	splitAudioBlob,
	SPLIT_THRESHOLD_SECONDS,
	SEGMENT_DURATION_SECONDS,
} from "./AudioSplitter";

export class AudioHandler {
	private plugin: Whisper;

	constructor(plugin: Whisper) {
		this.plugin = plugin;
	}

	private getPostProcessingApiKey(): string {
		switch (this.plugin.settings.postProcessingProvider) {
			case "anthropic":
				return this.plugin.settings.anthropicApiKey;
			case "openai":
				return this.plugin.settings.openAiApiKey;
			case "custom":
				return this.plugin.settings.postProcessingApiKey;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (
			folderPath &&
			!(await this.plugin.app.vault.adapter.exists(folderPath))
		) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	private async callTranscriptionApi(
		blob: Blob,
		fileName: string
	): Promise<string> {
		if (this.plugin.settings.debugMode) {
			new Notice("Transcribing...");
		}

		const formData = new FormData();
		formData.append("file", blob, fileName);
		formData.append("model", this.plugin.settings.model);
		if (
			this.plugin.settings.language &&
			this.plugin.settings.language !== "auto"
		) {
			formData.append("language", this.plugin.settings.language);
		}

		let prompt = this.plugin.settings.prompt || "";
		if (this.plugin.settings.cursorContext) {
			const editor =
				this.plugin.app.workspace.getActiveViewOfType(
					MarkdownView
				)?.editor;
			if (editor) {
				const context = getCursorContext(editor);
				prompt = prompt ? `${prompt}\n${context}` : context;
			}
		}
		if (prompt) formData.append("prompt", prompt);

		if (this.plugin.settings.temperature !== 0)
			formData.append(
				"temperature",
				String(this.plugin.settings.temperature)
			);
		if (this.plugin.settings.responseFormat !== "json")
			formData.append(
				"response_format",
				this.plugin.settings.responseFormat
			);

		for (const { key, value } of this.plugin.settings
			.transcriptionExtraParams) {
			if (key.trim()) formData.append(key.trim(), value);
		}

		const response = await axios.post(
			this.plugin.settings.apiUrl,
			formData,
			{
				headers: {
					"Content-Type": "multipart/form-data",
					...(this.plugin.settings.apiKey
						? {
								Authorization: `Bearer ${this.plugin.settings.apiKey}`,
						  }
						: {}),
				},
			}
		);
		return response.data.text as string;
	}

	private async transcribeSegmented(
		blob: Blob,
		baseFileName: string,
		preDecoded?: AudioBuffer
	): Promise<string> {
		const notice = new Notice("Splitting audio...", 0);
		const segments = await splitAudioBlob(
			blob,
			SEGMENT_DURATION_SECONDS,
			preDecoded,
			this.plugin.settings.silenceThreshold
		);
		const texts: string[] = new Array(segments.length);
		const concurrency = this.plugin.settings.concurrentTranscriptions;

		// Worker pool: N workers pull from a shared queue so a free worker
		// immediately picks up the next segment without waiting for others.
		const queue: Array<[number, Blob]> = segments.map((seg, i) => [i, seg]);

		const worker = async (): Promise<void> => {
			while (queue.length > 0) {
				const item = queue.shift();
				if (!item) return;
				const [idx, segment] = item;
				notice.setMessage(
					`Transcribing segment ${idx + 1}/${segments.length}...`
				);
				try {
					texts[idx] = await this.callTranscriptionApi(
						segment,
						`${baseFileName}_part${idx + 1}.wav`
					);
				} catch (err) {
					console.error(
						`Segment ${idx + 1} transcription failed:`,
						err
					);
					texts[idx] = `[Segment ${idx + 1} transcription failed]`;
				}
			}
		};

		await Promise.all(Array.from({ length: concurrency }, worker));

		notice.hide();
		return texts.join("\n\n");
	}

	async sendAudioData(blob: Blob, fileName: string): Promise<void> {
		// Get the base file name without extension
		const baseFileName = getBaseFileName(fileName);

		const audioFilePath = `${
			this.plugin.settings.audioSavePath
				? `${this.plugin.settings.audioSavePath}/`
				: ""
		}${fileName}`;

		const noteFilePath = `${
			this.plugin.settings.noteSavePath
				? `${this.plugin.settings.noteSavePath}/`
				: ""
		}${baseFileName}.md`;

		if (this.plugin.settings.debugMode) {
			new Notice(`Sending ${Math.round(blob.size / 1000)} KB...`);
		}

		const isDefaultApi =
			this.plugin.settings.apiUrl ===
			"https://api.openai.com/v1/audio/transcriptions";
		if (isDefaultApi && !this.plugin.settings.apiKey) {
			new Notice("✘ Add your API key in Whisper settings");
			return;
		}

		const MIN_AUDIO_SIZE_BYTES = 1000;
		if (blob.size < MIN_AUDIO_SIZE_BYTES) {
			new Notice("✘ Recording too short");
			return;
		}

		try {
			// If the saveAudioFile setting is true, save the audio file
			if (this.plugin.settings.saveAudioFile) {
				await this.ensureFolderExists(
					this.plugin.settings.audioSavePath
				);
				const arrayBuffer = await blob.arrayBuffer();
				await this.plugin.app.vault.adapter.writeBinary(
					audioFilePath,
					new Uint8Array(arrayBuffer)
				);
				// No notice for intermediate save — final "Transcription complete" covers it
			}
		} catch (err) {
			console.error("Error saving audio file:", err);
			new Notice(
				"✘ Couldn't save audio: " +
					(err instanceof Error ? err.message : String(err))
			);
		}

		try {
			const { duration, buffer: cachedBuffer } = await probeAudio(blob);
			let originalText: string;
			if (duration > SPLIT_THRESHOLD_SECONDS) {
				originalText = await this.transcribeSegmented(
					blob,
					baseFileName,
					cachedBuffer ?? undefined
				);
			} else {
				originalText = await this.callTranscriptionApi(blob, fileName);
			}
			let finalText = originalText;

			// Post-process with LLM if enabled
			if (this.plugin.settings.postProcessing) {
				const ppApiKey = this.getPostProcessingApiKey();
				if (!ppApiKey) {
					new Notice(
						"✘ Add your post-processing API key in settings"
					);
					return;
				}
				try {
					if (this.plugin.settings.debugMode) {
						new Notice("Post-processing...");
					}
					const processor = new PostProcessor({
						apiKey: ppApiKey,
						model: this.plugin.settings.postProcessingModel,
						url: this.plugin.settings.postProcessingUrl,
						provider: this.plugin.settings.postProcessingProvider,
					});
					finalText = await processor.process(
						originalText,
						this.plugin.settings.postProcessingPrompt
					);
				} catch (err) {
					console.error("Post-processing failed:", err);
					new Notice(
						"✘ Post-processing failed, using original transcription"
					);
					finalText = originalText;
				}
			}

			// Auto-generate title for the note filename
			let generatedTitle = baseFileName;
			if (
				this.plugin.settings.autoGenerateTitle &&
				this.plugin.settings.createNoteFile
			) {
				const ppApiKey = this.getPostProcessingApiKey();
				if (ppApiKey) {
					try {
						const processor = new PostProcessor({
							apiKey: ppApiKey,
							model: this.plugin.settings.postProcessingModel,
							url: this.plugin.settings.postProcessingUrl,
							provider: this.plugin.settings.postProcessingProvider,
						});
						const title = await processor.process(
							finalText,
							this.plugin.settings.titleGenerationPrompt
						);
						const sanitizedTitle = title
							.replace(/[/\\?%*:|"<>\n]/g, "-")
							.trim();
						if (sanitizedTitle) {
							generatedTitle = sanitizedTitle;
						}
					} catch (err) {
						console.error("Title generation failed:", err);
					}
				}
			}

			// Build note content with templates
			const outputText =
				this.plugin.settings.keepOriginalTranscription &&
				finalText !== originalText
					? `${finalText}\n\n---\n\n*Original transcription:*\n${originalText}`
					: finalText;

			if (this.plugin.settings.createNoteFile) {
				await this.ensureFolderExists(
					this.plugin.settings.noteSavePath
				);

				const vars = buildTemplateVariables(
					outputText,
					generatedTitle,
					audioFilePath
				);

				// Resolve filename template
				const resolvedFilename =
					resolveTemplate(
						this.plugin.settings.noteFilenameTemplate,
						vars
					)
						.replace(/[/\\?%*:|"<>\n]/g, "-")
						.trim() || baseFileName;

				const folder = this.plugin.settings.noteSavePath;
				const resolvedNoteFilePath = `${
					folder ? `${folder}/` : ""
				}${resolvedFilename}.md`;

				// Resolve note content template
				const noteContent = resolveTemplate(
					this.plugin.settings.noteTemplate,
					vars
				).trim();

				await this.plugin.app.vault.create(
					resolvedNoteFilePath,
					noteContent
				);
			}

			// Paste at cursor if setting is enabled
			if (this.plugin.settings.pasteAtCursor) {
				const editor =
					this.plugin.app.workspace.getActiveViewOfType(
						MarkdownView
					)?.editor;
				if (editor) {
					const cursorPosition = editor.getCursor();
					editor.replaceRange(outputText, cursorPosition);

					const newPosition = {
						line: cursorPosition.line,
						ch: cursorPosition.ch + outputText.length,
					};
					editor.setCursor(newPosition);
				}
			}

			new Notice("Transcription complete");
		} catch (err) {
			console.error("Error parsing audio:", err);
			new Notice(
				"✘ Transcription failed: " +
					(err instanceof Error ? err.message : String(err))
			);
		}
	}
}
