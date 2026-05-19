import Whisper from "main";
import { ButtonComponent, Modal } from "obsidian";
import { RecordingStatus } from "./StatusBar";

export class Controls extends Modal {
	private plugin: Whisper;
	private startMicButton: ButtonComponent;
	private startSystemButton: ButtonComponent;
	private startBothButton: ButtonComponent;
	private pauseButton: ButtonComponent;
	private stopButton: ButtonComponent;
	private cancelButton: ButtonComponent;
	private timerDisplay: HTMLElement;
	private statusListener: () => void;

	constructor(plugin: Whisper) {
		super(plugin.app);
		this.plugin = plugin;
		this.containerEl.addClass("recording-controls");

		this.timerDisplay = this.contentEl.createEl("div", { cls: "timer" });
		this.updateTimerDisplay();

		this.plugin.timer.setOnUpdate(() => {
			this.updateTimerDisplay();
		});

		const buttonGroupEl = this.contentEl.createEl("div", {
			cls: "button-group",
		});

		this.startMicButton = new ButtonComponent(buttonGroupEl);
		this.startMicButton
			.setIcon("mic")
			.setButtonText(" Mic")
			.onClick(() => this.plugin.startRecording("microphone"))
			.buttonEl.addClass("button-component");

		this.startSystemButton = new ButtonComponent(buttonGroupEl);
		this.startSystemButton
			.setIcon("volume-up")
			.setButtonText(" System")
			.onClick(() => this.plugin.startRecording("system"))
			.buttonEl.addClass("button-component");

		this.startBothButton = new ButtonComponent(buttonGroupEl);
		this.startBothButton
			.setIcon("mic")
			.setButtonText(" Both")
			.onClick(() => this.plugin.startRecording("both"))
			.buttonEl.addClass("button-component");

		this.pauseButton = new ButtonComponent(buttonGroupEl);
		this.pauseButton
			.setIcon("pause")
			.setButtonText(" Pause")
			.onClick(() => this.plugin.pauseRecording())
			.buttonEl.addClass("button-component");

		this.stopButton = new ButtonComponent(buttonGroupEl);
		this.stopButton
			.setIcon("square")
			.setButtonText(" Stop")
			.onClick(async () => {
				await this.plugin.stopRecording();
				this.close();
			})
			.buttonEl.addClass("button-component");

		this.cancelButton = new ButtonComponent(buttonGroupEl);
		this.cancelButton
			.setIcon("x")
			.setButtonText(" Cancel")
			.onClick(async () => {
				await this.plugin.cancelRecording();
				this.close();
			})
			.buttonEl.addClass("button-component");

		this.statusListener = () => {
			this.resetGUI();
			this.updateTimerDisplay();
		};
	}

	onOpen() {
		this.resetGUI();
		this.updateTimerDisplay();
		this.plugin.statusBar.onChange(this.statusListener);
	}

	onClose() {
		this.plugin.statusBar.offChange(this.statusListener);
	}

	updateTimerDisplay() {
		this.timerDisplay.textContent = this.plugin.timer.getFormattedTime();
	}

	resetGUI() {
		const status = this.plugin.statusBar.status;
		const isIdle = status === RecordingStatus.Idle;
		const isPaused = status === RecordingStatus.Paused;

		this.startMicButton.buttonEl.style.display = isIdle ? "" : "none";
		this.startMicButton.buttonEl.empty();
		this.startMicButton.setIcon("mic");
		this.startMicButton.buttonEl.appendText(" Mic");

		this.startSystemButton.buttonEl.style.display = isIdle ? "" : "none";
		this.startSystemButton.buttonEl.empty();
		this.startSystemButton.setIcon("volume-up");
		this.startSystemButton.buttonEl.appendText(" System");

		this.startBothButton.buttonEl.style.display = isIdle ? "" : "none";
		this.startBothButton.buttonEl.empty();
		this.startBothButton.setIcon("mic");
		this.startBothButton.buttonEl.appendText(" Both");

		this.pauseButton.buttonEl.style.display = isIdle ? "none" : "";
		this.pauseButton.buttonEl.empty();
		this.pauseButton.setIcon(isPaused ? "play" : "pause");
		this.pauseButton.buttonEl.appendText(isPaused ? " Resume" : " Pause");

		this.stopButton.buttonEl.style.display = isIdle ? "none" : "";
		this.stopButton.buttonEl.empty();
		this.stopButton.setIcon("square");
		this.stopButton.buttonEl.appendText(" Stop");

		this.cancelButton.buttonEl.style.display = isIdle ? "none" : "";
		this.cancelButton.buttonEl.empty();
		this.cancelButton.setIcon("x");
		this.cancelButton.buttonEl.appendText(" Cancel");
	}
}
