import { Notice } from "obsidian";
import { AudioSourceMode } from "./SettingsManager";

export interface AudioRecorder {
	startRecording(): Promise<void>;
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
	private audioSourceMode: AudioSourceMode = "microphone";
	private audioContext: AudioContext | null = null;
	private activeStreams: MediaStream[] = [];

	getRecordingState(): "inactive" | "recording" | "paused" | undefined {
		return this.recorder?.state;
	}

	getMimeType(): string | undefined {
		return this.mimeType;
	}

	setDeviceId(deviceId: string | null): void {
		this.deviceId = deviceId;
	}

	setAudioSourceMode(mode: AudioSourceMode): void {
		this.audioSourceMode = mode;
	}

	getAudioSourceMode(): AudioSourceMode {
		return this.audioSourceMode;
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

	private async startSystemAudioCapture(): Promise<AudioCaptureResult> {
		new Notice("Select a tab, window, or screen to capture audio from");
		
		const stream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: true,
		});

		const audioTracks = stream.getAudioTracks();
		const videoTracks = stream.getVideoTracks();

		if (audioTracks.length === 0) {
			videoTracks.forEach((track) => track.stop());
			throw new Error("No audio track available in the selected source. Please select a source with audio (e.g., a browser tab with audio playing).");
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

	async startRecording(): Promise<void> {
		if (this.recorder) {
			return;
		}

		try {
			let audioStream: MediaStream;
			let videoTracksToStop: MediaStreamTrack[] = [];

			switch (this.audioSourceMode) {
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
					throw new Error(`Unknown audio source mode: ${this.audioSourceMode}`);
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
			new Notice(`Recording from ${modeName[this.audioSourceMode]}...`);

		} catch (err) {
			this.cleanupStreams();
			
			if (err instanceof Error) {
				if (err.name === "NotAllowedError") {
					if (this.audioSourceMode === "system" || this.audioSourceMode === "both") {
						new Notice("Permission denied. Please allow screen/audio sharing to capture system audio.");
					} else {
						new Notice("Microphone permission denied");
					}
				} else if (err.message.includes("No audio track")) {
					new Notice(err.message);
				} else {
					new Notice(`Could not start recording: ${err.message}`);
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
