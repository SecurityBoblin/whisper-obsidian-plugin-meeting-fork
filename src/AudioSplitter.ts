export const SPLIT_THRESHOLD_SECONDS = 600; // 10 minutes
export const SEGMENT_DURATION_SECONDS = 300; // 5 minutes

export async function getAudioDuration(blob: Blob): Promise<number> {
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

export async function splitAudioBlob(
	blob: Blob,
	segmentSeconds: number
): Promise<Blob[]> {
	const arrayBuffer = await blob.arrayBuffer();
	const audioCtx = new AudioContext();
	const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
	audioCtx.close();

	const sampleRate = audioBuffer.sampleRate;
	const totalSamples = audioBuffer.length;
	const segmentSamples = Math.floor(segmentSeconds * sampleRate);
	const segments: Blob[] = [];

	let start = 0;
	while (start < totalSamples) {
		const end = Math.min(start + segmentSamples, totalSamples);
		segments.push(encodeWavBlob(audioBuffer, start, end));
		start = end;
	}

	return segments;
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
