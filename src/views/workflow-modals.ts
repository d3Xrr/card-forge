import { type App, Modal, Setting } from 'obsidian';

export interface TextPromptOptions {
	title: string;
	label: string;
	initialValue?: string;
	confirmLabel?: string;
}

export function promptForText(
	app: App,
	options: TextPromptOptions,
): Promise<string | null> {
	return new Promise((resolve) => {
		new TextPromptModal(app, options, resolve).open();
	});
}

export function confirmWorkflowAction(
	app: App,
	title: string,
	message: string,
	confirmLabel: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new WorkflowConfirmationModal(
			app,
			title,
			message,
			confirmLabel,
			resolve,
		).open();
	});
}

class TextPromptModal extends Modal {
	private settled = false;
	private value: string;

	constructor(
		app: App,
		private readonly options: TextPromptOptions,
		private readonly resolve: (value: string | null) => void,
	) {
		super(app);
		this.value = options.initialValue ?? '';
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		const setting = new Setting(this.contentEl)
			.setName(this.options.label)
			.addText((text) => {
				text.setValue(this.value).onChange((value) => {
					this.value = value;
				});
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						this.finish(this.value);
					}
				});
			});
		setting.addButton((button) => button
			.setButtonText('Cancel')
			.onClick(() => this.finish(null)));
		setting.addButton((button) => button
			.setButtonText(this.options.confirmLabel ?? 'Save')
			.setCta()
			.onClick(() => this.finish(this.value)));
	}

	onClose(): void {
		this.contentEl.empty();
		this.settle(null);
	}

	private finish(value: string | null): void {
		this.settle(value);
		this.close();
	}

	private settle(value: string | null): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.resolve(value);
	}
}

class WorkflowConfirmationModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.createEl('p', { text: this.message });
		const actions = new Setting(this.contentEl);
		actions.addButton((button) => button
			.setButtonText('Cancel')
			.onClick(() => this.finish(false)));
		actions.addButton((button) => {
			button.setButtonText(this.confirmLabel);
			button.buttonEl.addClass('mod-warning');
			button.onClick(() => this.finish(true));
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.settle(false);
	}

	private finish(confirmed: boolean): void {
		this.settle(confirmed);
		this.close();
	}

	private settle(confirmed: boolean): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.resolve(confirmed);
	}
}
