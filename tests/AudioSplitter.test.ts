import { describe, it, expect } from "vitest";
import { analyzeSplits } from "../src/AudioSplitter";

// Build a minimal AudioBuffer mock — enough for analyzeSplits / findSplitPoint
function makeMockBuffer(data: Float32Array, sampleRate = 16000): AudioBuffer {
	return {
		sampleRate,
		length: data.length,
		numberOfChannels: 1,
		duration: data.length / sampleRate,
		getChannelData: (_ch: number) => data,
	} as unknown as AudioBuffer;
}

// All samples at a constant amplitude
function makeConstantBuffer(
	amplitude: number,
	seconds: number,
	sampleRate = 16000
): AudioBuffer {
	const data = new Float32Array(Math.floor(seconds * sampleRate)).fill(
		amplitude
	);
	return makeMockBuffer(data, sampleRate);
}

// Loud buffer with a region of silence (amplitude 0) inserted
function makeSilenceAtBuffer(
	totalSeconds: number,
	silenceStartSeconds: number,
	silenceEndSeconds: number,
	amplitude = 0.5,
	sampleRate = 16000
): AudioBuffer {
	const length = Math.floor(totalSeconds * sampleRate);
	const data = new Float32Array(length).fill(amplitude);
	const silenceStart = Math.floor(silenceStartSeconds * sampleRate);
	const silenceEnd = Math.floor(silenceEndSeconds * sampleRate);
	data.fill(0, silenceStart, silenceEnd);
	return makeMockBuffer(data, sampleRate);
}

// Loud leading section followed by a quiet (but non-zero) tail
function makeLoudThenQuietBuffer(
	loudSeconds: number,
	quietSeconds: number,
	loudAmplitude = 0.5,
	quietAmplitude = 0.1,
	sampleRate = 16000
): AudioBuffer {
	const loudLen = Math.floor(loudSeconds * sampleRate);
	const quietLen = Math.floor(quietSeconds * sampleRate);
	const data = new Float32Array(loudLen + quietLen);
	data.fill(loudAmplitude, 0, loudLen);
	data.fill(quietAmplitude, loudLen);
	return makeMockBuffer(data, sampleRate);
}

describe("analyzeSplits", () => {
	// Use 10s segments so buffers stay small and the 30s search window covers
	// the entire segment — simplifies reasoning about where snaps occur.
	//
	// IMPORTANT: tests that trigger silence-snapping use 15s total buffers so
	// after the first snap the remaining audio is < 1 segment and `analyzeSplits`
	// uses `totalSamples` directly (no recursive findSplitPoint call needed).
	// This avoids a known edge case where findSplitPoint can return a sample
	// equal to `start`, stalling the outer loop.
	const SEG = 10;

	it("returns [start, end] for audio shorter than one segment", () => {
		const buffer = makeConstantBuffer(0.5, 5);
		const points = analyzeSplits(buffer, SEG, 0.015);
		expect(points).toHaveLength(2);
		expect(points[0]).toEqual({ seconds: 0, silence: false });
		expect(points[1].seconds).toBeCloseTo(5, 2);
		expect(points[1].silence).toBe(false);
	});

	it("falls back to exact boundary when no silence found", () => {
		// Loud signal throughout — RMS (≈0.5) is well above any sane threshold
		const buffer = makeConstantBuffer(0.5, 20);
		const points = analyzeSplits(buffer, SEG, 0.015);
		expect(points).toHaveLength(3); // [0, 10, 20]
		expect(points[1].silence).toBe(false);
		expect(points[1].seconds).toBeCloseTo(10, 1);
	});

	it("snaps to silence when silence is present near the segment boundary", () => {
		// 15s buffer, silence from 8–9 s, 10s segment boundary.
		// findSplitPoint searches back up to 30s, finds the 1s silence, snaps to
		// its start. The remaining 7s after the snap is < 1 segment so the second
		// point hits totalSamples directly (no further findSplitPoint call).
		const buffer = makeSilenceAtBuffer(15, 8, 9);
		const points = analyzeSplits(buffer, SEG, 0.015);
		expect(points[1].silence).toBe(true);
		expect(points[1].seconds).toBeGreaterThanOrEqual(8);
		expect(points[1].seconds).toBeLessThan(10);
	});

	it("respects a higher threshold — treats quiet signal as silence", () => {
		// 15s buffer: 5s loud (0.5) then 10s quiet (0.1).
		// threshold 0.05: quiet section (0.1) > 0.05 → NOT silent → exact boundary
		// threshold 0.2:  quiet section (0.1) < 0.2  → IS  silent → snaps to ~5s
		// After the snap the remainder (< 1 segment) hits totalSamples directly.
		const buffer = makeLoudThenQuietBuffer(5, 10);

		const lowThresh = analyzeSplits(buffer, SEG, 0.05);
		expect(lowThresh[1].silence).toBe(false);
		expect(lowThresh[1].seconds).toBeCloseTo(10, 1);

		const highThresh = analyzeSplits(buffer, SEG, 0.2);
		expect(highThresh[1].silence).toBe(true);
		expect(highThresh[1].seconds).toBeGreaterThanOrEqual(5);
		expect(highThresh[1].seconds).toBeLessThan(10);
	});

	it("respects a lower threshold — loud signal is never silent", () => {
		const buffer = makeConstantBuffer(0.5, 20);
		// 0.5 > 0.3 → not silent, even with a generous threshold
		const points = analyzeSplits(buffer, SEG, 0.3);
		expect(points[1].silence).toBe(false);
	});

	it("produces the correct number of split points for multi-segment audio", () => {
		// 40s / 10s segments → 4 segments → 5 points
		const buffer = makeConstantBuffer(0.5, 40);
		const points = analyzeSplits(buffer, SEG, 0.015);
		expect(points).toHaveLength(5);
	});

	it("always starts at 0 and ends at buffer duration", () => {
		const buffer = makeConstantBuffer(0.5, 45);
		const points = analyzeSplits(buffer, SEG, 0.015);
		expect(points[0].seconds).toBe(0);
		expect(points[points.length - 1].seconds).toBeCloseTo(45, 1);
	});
});
