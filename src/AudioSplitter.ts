export const SPLIT_THRESHOLD_SECONDS = 600; // 10 minutes
export const SEGMENT_DURATION_SECONDS = 300; // 5 minutes

// Silence detection constants (internal)
const SPLIT_SEARCH_WINDOW_S = 30; // search up to 30 s before the target boundary
const SILENCE_THRESHOLD_RMS = 0.015; // RMS below this = silence
const MIN_SILENCE_S = 0.3; // silence must last at least 300 ms
const RMS_WINDOW_S = 0.05; // 50 ms analysis windows

/**
 * Returns the audio duration and, if decoding was required to determine it
 * (e.g. WebM files from MediaRecorder which lack duration metadata), the
 * pre-decoded AudioBuffer so callers can reuse it without a second decode.
 */
export async function probeAudio(
	blob: Blob
): Promise<{ duration: number; buffer: AudioBuffer | null }> {
	const metaDuration = await getMetadataDuration(blob);
	if (isFinite(metaDuration)) {
		return { duration: metaDuration, buffer: null };
	}
	// Fallback: decode to get real duration (WebM from MediaRecorder reports Infinity)
	try {
		const buffer = await decodeAudio(blob);
		return { duration: buffer.duration, buffer };
	} catch {
		return { duration: 0, buffer: null };
	}
}

/**
 * Splits a Blob into segments of segmentSeconds length, re-encoded as WAV.
 * Pass a pre-decoded AudioBuffer to avoid decoding twice.
 */
export async function splitAudioBlob(
	blob: Blob,
	segmentSeconds: number,
	preDecoded?: AudioBuffer
): Promise<Blob[]> {
	const audioBuffer = preDecoded ?? (await decodeAudio(blob));

	const sampleRate = audioBuffer.sampleRate;
	const totalSamples = audioBuffer.length;
	const segmentSamples = Math.floor(segmentSeconds * sampleRate);
	const segments: Blob[] = [];

	let start = 0;
	while (start < totalSamples) {
		const rawEnd = Math.min(start + segmentSamples, totalSamples);
		// For all but the final segment, snap to a nearby silence
		const end =
			rawEnd === totalSamples
				? totalSamples
				: findSplitPoint(audioBuffer, rawEnd);
		segments.push(encodeWavBlob(audioBuffer, start, end));
		start = end;
	}

	return segments;
}

/**
 * Given a target split sample, scans the preceding SPLIT_SEARCH_WINDOW_S
 * seconds for the latest qualifying silence (RMS < threshold for >= MIN_SILENCE_S).
 * Returns the start sample of that silence, or targetSample as a fallback.
 */
function findSplitPoint(buffer: AudioBuffer, targetSample: number): number {
	const sr = buffer.sampleRate;
	const windowSamples = Math.floor(RMS_WINDOW_S * sr);
	const searchStart = Math.max(0, targetSample - Math.floor(SPLIT_SEARCH_WINDOW_S * sr));
	const minSilenceSamples = Math.floor(MIN_SILENCE_S * sr);
	const numChannels = buffer.numberOfChannels;

	let silenceRegionStart = -1;
	let bestSplit = targetSample;

	for (let pos = searchStart; pos < targetSample; pos += windowSamples) {
		const wEnd = Math.min(pos + windowSamples, targetSample);

		// RMS across all channels for this window
		let sumSq = 0;
		let n = 0;
		for (let ch = 0; ch < numChannels; ch++) {
			const data = buffer.getChannelData(ch);
			for (let i = pos; i < wEnd; i++) {
				sumSq += data[i] * data[i];
				n++;
			}
		}
		const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;

		if (rms < SILENCE_THRESHOLD_RMS) {
			if (silenceRegionStart === -1) silenceRegionStart = pos;
			// Record this as a candidate once silence is long enough
			if (pos + windowSamples - silenceRegionStart >= minSilenceSamples) {
				bestSplit = silenceRegionStart;
			}
		} else {
			silenceRegionStart = -1;
		}
	}

	return bestSplit;
}

async function getMetadataDuration(blob: Blob): Promise<number> {
	return new Promise((resolve) => {
		const audio = document.createElement("audio");
		const url = URL.createObjectURL(blob);
		audio.onloadedmetadata = () => {
			URL.revokeObjectURL(url);
			resolve(audio.duration);
		};
		audio.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(0);
		};
		audio.src = url;
	});
}

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
	const arrayBuffer = await blob.arrayBuffer();
	const audioCtx = new AudioContext();
	const buffer = await audioCtx.decodeAudioData(arrayBuffer);
	audioCtx.close();
	return buffer;
}

function encodeWavBlob(
	buffer: AudioBuffer,
	startSample: number,
	endSample: number
): Blob {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const numSamples = endSample - startSample;
	const bitsPerSample = 16;
	const blockAlign = numChannels * (bitsPerSample / 8);
	const byteRate = sampleRate * blockAlign;
	const dataLength = numSamples * blockAlign;

	const ab = new ArrayBuffer(44 + dataLength);
	const view = new DataView(ab);

	writeStr(view, 0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeStr(view, 8, "WAVE");

	writeStr(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	writeStr(view, 36, "data");
	view.setUint32(40, dataLength, true);

	let offset = 44;
	for (let i = startSample; i < endSample; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			const s = buffer.getChannelData(ch)[i];
			const clamped = Math.max(-1, Math.min(1, s));
			view.setInt16(
				offset,
				clamped < 0 ? clamped * 32768 : clamped * 32767,
				true
			);
			offset += 2;
		}
	}

	return new Blob([ab], { type: "audio/wav" });
}

function writeStr(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
