import { App, Notice } from "obsidian";
import { AudioSourceMode } from "./SettingsManager";
import { SourceSelectorModal, DesktopSource } from "./SourceSelectorModal";

export interface AudioRecorder {
	startRecording(mode: AudioSourceMode): Promise<void>;
	pauseRecording(): Promise<void>;
	stopRecording(): Promise<Blob>;
}

function getSupportedMimeType(): string | undefined {
	const mimeTypes = [
		"audio/webm",
		"audio/webm;codecs=opus",
		"audio/ogg",
		"audio/ogg;codecs=opus",
		"audio/mp4",
		"audio/mp4;codecs=mp4a.40.2",
		"audio/aac",
		"audio/wav",
		"audio/mp3",
	];

	for (const mimeType of mimeTypes) {
		if (MediaRecorder.isTypeSupported(mimeType)) {
			return mimeType;
		}
	}

	return undefined;
}

interface AudioCaptureResult {
	stream: MediaStream;
	videoTracks: MediaStreamTrack[];
}

export class NativeAudioRecorder implements AudioRecorder {
	private chunks: BlobPart[] = [];
	private recorder: MediaRecorder | null = null;
	private mimeType: string | undefined;
	private deviceId: string | null = null;
	private audioContext: AudioContext | null = null;
	private activeStreams: MediaStream[] = [];
	private app: App | null = null;

	getRecordingState(): "inactive" | "recording" | "paused" | undefined {
		return this.recorder?.state;
	}

	getMimeType(): string | undefined {
		return this.mimeType;
	}

	setDeviceId(deviceId: string | null): void {
		this.deviceId = deviceId;
	}

	setApp(app: App): void {
		this.app = app;
	}

	private async startMicrophoneCapture(): Promise<AudioCaptureResult> {
		const audioConstraints =
			this.deviceId && this.deviceId !== "default"
				? { deviceId: { exact: this.deviceId } }
				: true;

		const stream = await navigator.mediaDevices.getUserMedia({
			audio: audioConstraints,
		});

		return { stream, videoTracks: [] };
	}

	private isElectron(): boolean {
		try {
			const electronRequire = (window as any).require || require;
			electronRequire("electron");
			return true;
		} catch {
			return false;
		}
	}

	private async getDesktopCapturer(): Promise<{
		getSources: (options: { types: string[]; thumbnailSize?: { width: number; height: number } }) => Promise<DesktopSource[]>;
	} | null> {
		try {
			const winRequire = (window as any).require;
			
			if (typeof winRequire !== "function") {
				return null;
			}
			
			const electron = winRequire("electron");
			
			if (electron && electron.desktopCapturer) {
				return electron.desktopCapturer;
			}
			
			try {
				const remote = winRequire("@electron/remote");
				if (remote && remote.desktopCapturer) {
					return remote.desktopCapturer;
				}
			} catch {
				// @electron/remote not available
			}
			
			return null;
		} catch {
			return null;
		}
	}

	private async startSystemAudioCapture(): Promise<AudioCaptureResult> {
		const desktopCapturer = await this.getDesktopCapturer();

		if (!desktopCapturer) {
			throw new Error(
				"System audio capture is not available.\n\n" +
				"This feature requires Obsidian desktop app.\n" +
				"If you're on desktop, try restarting Obsidian."
			);
		}

		new Notice("Loading available sources...");

		let sources: DesktopSource[];
		try {
			const electronSources = await desktopCapturer.getSources({
				types: ["window", "screen"],
				thumbnailSize: { width: 160, height: 100 },
			});
			sources = electronSources;
		} catch (e) {
			throw new Error(
				"Failed to enumerate capture sources. Make sure Obsidian has screen recording permissions."
			);
		}

		if (sources.length === 0) {
			throw new Error(
				"No windows or screens found to capture. Open an application window and try again."
			);
		}

		if (!this.app) {
			throw new Error("App instance not set. Call setApp() before recording.");
		}

		const selectedSource = await SourceSelectorModal.selectSource(this.app, sources);

		if (!selectedSource) {
			throw new Error("Source selection cancelled");
		}

		new Notice(`Capturing from: ${selectedSource.name.substring(0, 30)}...`);

		const constraints: MediaStreamConstraints = {
			audio: {
				mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: selectedSource.id,
				},
			} as any,
			video: {
				mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: selectedSource.id,
				},
			} as any,
		};

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia(constraints);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			if (errMsg.includes("Permission")) {
				throw new Error(
					"Permission denied. Grant Obsidian screen recording access in System Settings > Privacy & Security > Screen Recording."
				);
			}
			throw new Error(`Failed to capture from selected source: ${errMsg}`);
		}

		const audioTracks = stream.getAudioTracks();
		const videoTracks = stream.getVideoTracks();

		if (audioTracks.length === 0) {
			videoTracks.forEach((track) => track.stop());
			stream.getTracks().forEach((track) => track.stop());
			throw new Error(
				"No audio in selected source.\n\n" +
				"Tips:\n" +
				"• Select a window playing audio (browser tab, media player)\n" +
				"• On Windows: Make sure 'Share audio' was enabled\n" +
				"• Some apps don't output audio through the capture API"
			);
		}

		const audioOnlyStream = new MediaStream(audioTracks);

		return { stream: audioOnlyStream, videoTracks };
	}

	private mixAudioStreams(
		micStream: MediaStream,
		systemStream: MediaStream
	): MediaStream {
		this.audioContext = new AudioContext();
		const destination = this.audioContext.createMediaStreamDestination();

		const micSource = this.audioContext.createMediaStreamSource(micStream);
		const systemSource = this.audioContext.createMediaStreamSource(systemStream);

		const micGain = this.audioContext.createGain();
		const systemGain = this.audioContext.createGain();
		micGain.gain.value = 1.0;
		systemGain.gain.value = 1.0;

		micSource.connect(micGain).connect(destination);
		systemSource.connect(systemGain).connect(destination);

		return destination.stream;
	}

	async startRecording(mode: AudioSourceMode): Promise<void> {
		if (this.recorder) {
			return;
		}

		try {
			let audioStream: MediaStream;
			let videoTracksToStop: MediaStreamTrack[] = [];

			switch (mode) {
				case "microphone":
					const micResult = await this.startMicrophoneCapture();
					audioStream = micResult.stream;
					videoTracksToStop = micResult.videoTracks;
					break;

				case "system":
					const sysResult = await this.startSystemAudioCapture();
					audioStream = sysResult.stream;
					videoTracksToStop = sysResult.videoTracks;
					break;

				case "both":
					const micCapture = await this.startMicrophoneCapture();
					const sysCapture = await this.startSystemAudioCapture();

					this.activeStreams.push(micCapture.stream, sysCapture.stream);
					videoTracksToStop = [...micCapture.videoTracks, ...sysCapture.videoTracks];

					audioStream = this.mixAudioStreams(
						micCapture.stream,
						sysCapture.stream
					);
					break;

				default:
					throw new Error(`Unknown audio source mode: ${mode}`);
			}

			this.activeStreams.push(audioStream);

			this.mimeType = getSupportedMimeType();

			if (!this.mimeType) {
				throw new Error("No supported mimeType found");
			}

			const options = { mimeType: this.mimeType };
			const recorder = new MediaRecorder(audioStream, options);

			recorder.addEventListener("dataavailable", (e: BlobEvent) => {
				this.chunks.push(e.data);
			});

			this.recorder = recorder;
			this.recorder.start(100);

			const modeName = {
				microphone: "microphone",
				system: "system audio",
				both: "microphone + system audio",
			};
			new Notice(`Recording from ${modeName[mode]}...`);

		} catch (err) {
			this.cleanupStreams();

			if (err instanceof Error) {
				if (err.name === "NotAllowedError") {
					new Notice("Microphone permission denied");
				} else if (err.message.includes("cancelled")) {
					new Notice("Recording cancelled");
				} else {
					new Notice(err.message);
				}
			} else {
				new Notice("Could not start recording");
			}
			console.error("Error initializing recorder:", err);
			throw err;
		}
	}

	private cleanupStreams(): void {
		this.activeStreams.forEach((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		});
		this.activeStreams = [];

		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
	}

	async pauseRecording(): Promise<void> {
		if (!this.recorder) {
			return;
		}

		if (this.recorder.state === "recording") {
			this.recorder.pause();
		} else if (this.recorder.state === "paused") {
			this.recorder.resume();
		}
	}

	async stopRecording(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.recorder || this.recorder.state === "inactive") {
				const blob = new Blob(this.chunks, { type: this.mimeType });
				this.chunks.length = 0;
				this.cleanupStreams();
				resolve(blob);
			} else {
				this.recorder.addEventListener(
					"stop",
					() => {
						const blob = new Blob(this.chunks, {
							type: this.mimeType,
						});
						this.chunks.length = 0;

						this.cleanupStreams();
						this.recorder = null;

						resolve(blob);
					},
					{ once: true }
				);

				this.recorder.stop();
			}
		});
	}
}
