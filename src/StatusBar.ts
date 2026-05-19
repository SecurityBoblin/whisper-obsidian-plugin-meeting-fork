import { Plugin } from "obsidian";
import { AudioSourceMode } from "./SettingsManager";

export enum RecordingStatus {
	Idle = "idle",
	Recording = "recording",
	Paused = "paused",
	Processing = "processing",
}

export class StatusBar {
	plugin: Plugin;
	statusBarItem: HTMLElement | null = null;
	status: RecordingStatus = RecordingStatus.Idle;
	private listeners: Array<(status: RecordingStatus) => void> = [];
	private currentMode: AudioSourceMode = "microphone";

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.statusBarItem = this.plugin.addStatusBarItem();
		this.updateStatusBarItem();
	}

	setAudioSourceMode(mode: AudioSourceMode): void {
		this.currentMode = mode;
		this.updateStatusBarItem();
	}

	onChange(listener: (status: RecordingStatus) => void): void {
		this.listeners.push(listener);
	}

	offChange(listener: (status: RecordingStatus) => void): void {
		this.listeners = this.listeners.filter((fn) => fn !== listener);
	}

	updateStatus(status: RecordingStatus) {
		this.status = status;
		this.updateStatusBarItem();
		this.listeners.forEach((fn) => fn(status));
	}

	private getModeIndicator(): string {
		switch (this.currentMode) {
			case "system":
				return "🔊 ";
			case "both":
				return "🎤🔊 ";
			case "microphone":
			default:
				return "🎤 ";
		}
	}

	updateStatusBarItem() {
		if (this.statusBarItem) {
			const modeIcon = this.getModeIndicator();
			switch (this.status) {
				case RecordingStatus.Recording:
					this.statusBarItem.textContent = `${modeIcon}Recording...`;
					this.statusBarItem.style.color = "red";
					break;
				case RecordingStatus.Paused:
					this.statusBarItem.textContent = `${modeIcon}Paused`;
					this.statusBarItem.style.color = "yellow";
					break;
				case RecordingStatus.Processing:
					this.statusBarItem.textContent = "Processing...";
					this.statusBarItem.style.color = "gray";
					break;
				case RecordingStatus.Idle:
				default:
					this.statusBarItem.textContent = `${modeIcon}Whisper`;
					this.statusBarItem.style.color = "green";
					break;
			}
		}
	}

	remove() {
		if (this.statusBarItem) {
			this.statusBarItem.remove();
		}
	}
}
