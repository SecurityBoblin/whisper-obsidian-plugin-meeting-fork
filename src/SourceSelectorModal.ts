import { App, Modal, Setting } from "obsidian";

export interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string;
}

function nativeImageToDataUrl(thumbnail: any): string {
	if (typeof thumbnail === "string") {
		return thumbnail;
	}
	if (thumbnail && typeof thumbnail.toDataURL === "function") {
		return thumbnail.toDataURL();
	}
	return "";
}

export class SourceSelectorModal extends Modal {
	private sources: DesktopSource[];
	private selectedSource: DesktopSource | null = null;
	private resolvePromise: ((source: DesktopSource | null) => void) | null = null;

	constructor(app: App, sources: DesktopSource[]) {
		super(app);
		this.sources = sources;
		this.titleEl.setText("Select Audio Source");
		this.modalEl.addClass("source-selector-modal");
	}

	static async selectSource(app: App, sources: DesktopSource[]): Promise<DesktopSource | null> {
		return new Promise((resolve) => {
			const modal = new SourceSelectorModal(app, sources);
			modal.resolvePromise = resolve;
			modal.open();
		});
	}

	onOpen() {
		const { contentEl } = this;

		if (this.sources.length === 0) {
			contentEl.createEl("p", { text: "No capture sources found." });
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);
			return;
		}

		contentEl.createEl("p", {
			text: "Select a window or screen to capture audio from. For best results, choose a window with audio playing.",
			cls: "source-selector-hint",
		});

		const listEl = contentEl.createDiv({ cls: "source-list" });

		for (const source of this.sources) {
			const itemEl = listEl.createDiv({ cls: "source-item" });

			const thumbnailUrl = nativeImageToDataUrl(source.thumbnail);
			
			const imgEl = itemEl.createEl("img", {
				cls: "source-thumbnail",
				attr: thumbnailUrl ? { src: thumbnailUrl } : {},
			});
			imgEl.style.width = "200px";
			imgEl.style.height = "125px";
			imgEl.style.objectFit = "cover";
			imgEl.style.borderRadius = "4px";
			imgEl.style.border = "2px solid transparent";
			imgEl.style.backgroundColor = "var(--background-modifier-border)";

			itemEl.createEl("div", {
				text: source.name,
				cls: "source-name",
			});
			itemEl.style.cursor = "pointer";
			itemEl.style.textAlign = "center";
			itemEl.style.margin = "10px";
			itemEl.style.display = "inline-block";

			itemEl.addEventListener("click", () => {
				this.selectedSource = source;
				this.close();
			});

			itemEl.addEventListener("mouseenter", () => {
				imgEl.style.borderColor = "var(--interactive-accent)";
			});
			itemEl.addEventListener("mouseleave", () => {
				imgEl.style.borderColor = "transparent";
			});
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise(this.selectedSource);
		}
	}
}
