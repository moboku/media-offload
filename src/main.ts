import { EditorView } from "@codemirror/view";
import {
	App,
	Editor,
	EditorPosition,
	FileSystemAdapter,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { t } from "./i18n";

type Kind = "image" | "video" | "audio";

interface Settings {
	folder: string;
	imageExts: string;
	videoExts: string;
	audioExts: string;
	handlePasteDrop: boolean;
	autoMoveAttachments: boolean;
	dedupeByContent: boolean;
	dragResize: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	folder: "",
	imageExts: "png, jpg, jpeg, gif, webp, avif, svg, heic",
	videoExts: "mp4, mov, m4v, webm",
	audioExts: "",
	handlePasteDrop: true,
	autoMoveAttachments: true,
	dedupeByContent: false,
	dragResize: true,
};

const MIME_EXT: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/svg+xml": ".svg",
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/webm": ".webm",
	"audio/mpeg": ".mp3",
	"audio/mp4": ".m4a",
	"audio/wav": ".wav",
};

const fsp = fs.promises;
const sha256 = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

async function fileSha256(file: string): Promise<string> {
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** Obsidian gives dropped files a `path` on desktop. */
type DesktopFile = File & { path?: string };

export default class MediaOffloadPlugin extends Plugin {
	settings!: Settings;
	private busy = new Set<string>();
	private kinds = new Map<string, Kind>();

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<Settings> | null);
		this.rebuildKinds();
		this.addSettingTab(new MediaOffloadSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-drop", (event, editor) => {
				if (!this.settings.handlePasteDrop || event.defaultPrevented) return;
				const files = this.mediaFiles(event.dataTransfer?.files);
				if (!files.length) return;
				event.preventDefault();
				event.stopPropagation();
				void this.importFiles(files, editor, editor.getCursor());
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-paste", (event, editor) => {
				if (!this.settings.handlePasteDrop || event.defaultPrevented) return;
				const files = this.mediaFiles(event.clipboardData?.files);
				if (!files.length) return;
				event.preventDefault();
				event.stopPropagation();
				void this.importFiles(files, editor, editor.getCursor());
			}),
		);

		// Attachments that still land in the vault (another plugin, sync, a file copied in by hand).
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (!this.settings.autoMoveAttachments || !(file instanceof TFile) || !this.kindOf(file.name)) return;
					window.setTimeout(() => void this.reconcile(file).catch((e) => this.fail(e)), 2000);
				}),
			);
		});

		this.addCommand({
			id: "move-current-attachment",
			name: t().cmdMoveCurrent,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.kindOf(file.name)) return false;
				if (!checking) void this.reconcile(file, true).catch((e) => this.fail(e));
				return true;
			},
		});

		const sizes: [string, string, number | null][] = [
			["small", "240 px", 240],
			["medium", "400 px", 400],
			["large", "600 px", 600],
			["original", t().originalSize, null],
		];
		for (const [id, label, width] of sizes) {
			this.addCommand({
				id: `resize-image-${id}`,
				name: t().cmdResize(label),
				editorCallback: (editor) => this.resizeAtCursor(editor, width),
			});
		}

		this.setupDragResize();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.rebuildKinds();
	}

	/** Folder where media is stored; defaults to ~/Obsidian Media/<vault name>. */
	root(): string {
		const raw = this.settings.folder.trim();
		if (!raw) return path.join(os.homedir(), "Obsidian Media", this.app.vault.getName());
		return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
	}

	private rebuildKinds(): void {
		this.kinds.clear();
		const add = (list: string, kind: Kind) => {
			for (const ext of list.split(/[\s,]+/)) {
				const e = ext.trim().replace(/^\./, "").toLowerCase();
				if (e) this.kinds.set("." + e, kind);
			}
		};
		add(this.settings.imageExts, "image");
		add(this.settings.videoExts, "video");
		add(this.settings.audioExts, "audio");
	}

	kindOf(name: string): Kind | undefined {
		return this.kinds.get(path.extname(name).toLowerCase());
	}

	private mediaFiles(list: FileList | undefined | null): File[] {
		return [...(list ?? [])].filter((f) => this.kindOf(f.name) || this.kinds.get(MIME_EXT[f.type] ?? ""));
	}

	private embed(file: string, kind: Kind): string {
		const url = pathToFileURL(file).href;
		if (kind === "video") return `<video src="${url}" controls></video>`;
		if (kind === "audio") return `<audio src="${url}" controls></audio>`;
		return `![](${url})`;
	}

	private fail(e: unknown): void {
		console.error(e);
		new Notice(t().moveFailed(errMsg(e)));
	}

	// ---------- storing ----------

	async importFiles(files: File[], editor: Editor, anchor: EditorPosition): Promise<void> {
		const links: string[] = [];
		for (const file of files as DesktopFile[]) {
			try {
				const fromName = path.extname(file.name).toLowerCase();
				const ext = this.kindOf(file.name) ? fromName : (MIME_EXT[file.type] ?? fromName);
				const kind = this.kinds.get(ext);
				if (!kind) continue;
				const onDisk = file.path ? await fsp.stat(file.path).then((s) => s.isFile(), () => false) : false;
				const target =
					onDisk && file.path
						? await this.storePath(file.path, ext)
						: await this.storeBuffer(Buffer.from(await file.arrayBuffer()), ext);
				links.push(this.embed(target, kind));
			} catch (e) {
				console.error(e);
				new Notice(t().importFailed(file.name, errMsg(e)), 8000);
			}
		}
		if (links.length) editor.replaceRange(links.join("\n"), anchor);
	}

	private async existing(hash: string, ext: string, size: number, hashOf: (f: string) => Promise<string>): Promise<string | null> {
		const root = this.root();
		const target = path.join(root, `${hash}${ext}`);
		try {
			await fsp.access(target);
			return target;
		} catch (e) {
			if (!isMissing(e)) throw e;
		}
		if (!this.settings.dedupeByContent) return null;
		// Files you put in the folder yourself may have other names: compare size first, then content.
		for await (const candidate of this.walk(root)) {
			const stat = await fsp.stat(candidate);
			if (stat.size === size && (await hashOf(candidate)) === hash) return candidate;
		}
		return null;
	}

	private async *walk(dir: string): AsyncGenerator<string> {
		let entries: fs.Dirent[];
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch (e) {
			if (isMissing(e)) return;
			throw e;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory() && !/^[._]/.test(entry.name)) yield* this.walk(full);
			else if (entry.isFile() && this.kindOf(entry.name)) yield full;
		}
	}

	async storeBuffer(buffer: Buffer, ext: string): Promise<string> {
		const root = this.root();
		await fsp.mkdir(root, { recursive: true });
		const hash = sha256(buffer);
		const found = await this.existing(hash, ext, buffer.length, async (f) => sha256(await fsp.readFile(f)));
		if (found) return found;
		const target = path.join(root, `${hash}${ext}`);
		const temp = path.join(root, `.${hash}-${crypto.randomUUID()}.tmp`);
		try {
			await fsp.writeFile(temp, buffer, { flag: "wx" });
			await fsp.rename(temp, target);
		} catch (e) {
			await fsp.rm(temp, { force: true });
			throw e;
		}
		return target;
	}

	async storePath(source: string, ext: string): Promise<string> {
		const root = this.root();
		await fsp.mkdir(root, { recursive: true });
		const stat = await fsp.stat(source);
		const hash = await fileSha256(source);
		const found = await this.existing(hash, ext, stat.size, fileSha256);
		if (found) return found;
		const target = path.join(root, `${hash}${ext}`);
		const temp = path.join(root, `.${hash}-${crypto.randomUUID()}.tmp`);
		try {
			await pipeline(fs.createReadStream(source), fs.createWriteStream(temp, { flags: "wx" }));
			if ((await fileSha256(temp)) !== hash) throw new Error(t().changedWhileCopying);
			await fsp.rename(temp, target);
		} catch (e) {
			await fsp.rm(temp, { force: true });
			throw e;
		}
		return target;
	}

	// ---------- moving attachments that are inside the vault ----------

	async reconcile(file: TFile, force = false, attempt = 0): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(file.path) !== file || this.busy.has(file.path)) return;
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const kind = this.kindOf(file.name);
		if (!kind) return;
		this.busy.add(file.path);
		try {
			const notes: TFile[] = [];
			for (const note of this.app.vault.getMarkdownFiles()) {
				const source = await this.app.vault.cachedRead(note);
				if (this.replaceReferences(source, file, note, "") !== source) notes.push(note);
			}
			if (!notes.length) {
				if (force) {
					new Notice(t().noReferences);
					return;
				}
				// The link may be written after the file (e.g. a capture prompt); keep checking for a minute.
				if (attempt < 12) {
					window.setTimeout(() => void this.reconcile(file, false, attempt + 1).catch((e) => this.fail(e)), 5000);
				}
				return;
			}
			if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
			const target = await this.storePath(adapter.getFullPath(file.path), path.extname(file.name).toLowerCase());
			const replacement = this.embed(target, kind);
			const changed: { note: TFile; before: string }[] = [];
			try {
				for (const note of notes) {
					const before = await this.app.vault.read(note);
					const after = this.replaceReferences(before, file, note, replacement);
					if (after === before) continue;
					await this.app.vault.modify(note, after);
					changed.push({ note, before });
				}
			} catch (e) {
				for (const entry of changed.reverse()) await this.app.vault.modify(entry.note, entry.before);
				throw e;
			}
			if (!changed.length) return;
			await this.app.fileManager.trashFile(file);
			new Notice(t().moved(file.name));
		} finally {
			this.busy.delete(file.path);
		}
	}

	/** Replace only links Obsidian resolves to this exact file. */
	replaceReferences(source: string, file: TAbstractFile, note: TFile, replacement: string): string {
		const resolves = (target: string): boolean =>
			this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(target), note.path)?.path === file.path;
		return source.replace(
			/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!?\[[^\]]*\]\(([^)]+)\)/g,
			(match: string, wiki?: string, md?: string) => {
				const target = (wiki ?? md ?? "").trim().replace(/^<|>$/g, "");
				try {
					return resolves(target) ? replacement : match;
				} catch {
					return match;
				}
			},
		);
	}

	// ---------- resizing ----------

	private resizeAtCursor(editor: Editor, width: number | null): void {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const all = [...line.matchAll(/!\[([^\]]*)\]\((file:[^)]+)\)|<img\b[^>]*>/gi)];
		const match =
			all.find((m) => cursor.ch >= (m.index ?? 0) && cursor.ch <= (m.index ?? 0) + m[0].length) ?? all[0];
		if (!match || match.index === undefined) {
			new Notice(t().cursorOnImage);
			return;
		}
		const url = match[2] ?? (/src=["']([^"']+)["']/i.exec(match[0]) ?? [])[1];
		if (!url) return;
		const sep = /^\s*\|/.test(line) ? "\\|" : "|";
		const next = `![${width ? sep + String(width) : ""}](${url})`;
		editor.replaceRange(
			next,
			{ line: cursor.line, ch: match.index },
			{ line: cursor.line, ch: match.index + match[0].length },
		);
	}

	/** Drag the right edge of an image in the editor; the width is written back as ![|w](url) or ![[file|w]]. */
	private setupDragResize(): void {
		const EDGE = 16;
		const nearEdge = (img: HTMLElement, e: MouseEvent): boolean => {
			const r = img.getBoundingClientRect();
			return e.clientX >= r.right - EDGE && e.clientX <= r.right + 4 && e.clientY >= r.top && e.clientY <= r.bottom;
		};
		const editorImg = (el: EventTarget | null): HTMLImageElement | null =>
			this.settings.dragResize && el instanceof HTMLImageElement && el.closest(".markdown-source-view .cm-editor")
				? el
				: null;
		let drag: { img: HTMLImageElement; view: EditorView; startX: number; startWidth: number; width: number | null } | null =
			null;

		this.registerDomEvent(
			document,
			"mousemove",
			(e) => {
				if (drag) {
					const width = Math.max(60, Math.round(drag.startWidth + e.clientX - drag.startX));
					drag.width = width;
					drag.img.setCssProps({ "--media-offload-width": `${width}px` });
					return;
				}
				const img = editorImg(e.target);
				if (img) img.toggleClass("media-offload-resizable", nearEdge(img, e));
			},
			true,
		);

		this.registerDomEvent(
			document,
			"mousedown",
			(e) => {
				const img = editorImg(e.target);
				if (e.button !== 0 || !img || !nearEdge(img, e)) return;
				const view = EditorView.findFromDOM(img);
				if (!view) return;
				e.preventDefault();
				e.stopPropagation();
				img.addClass("media-offload-dragging");
				drag = { img, view, startX: e.clientX, startWidth: img.getBoundingClientRect().width, width: null };
				activeDocument.body.addClass("media-offload-resizing");
			},
			true,
		);

		this.registerDomEvent(
			document,
			"mouseup",
			(e) => {
				if (!drag) return;
				const current = drag;
				drag = null;
				activeDocument.body.removeClass("media-offload-resizing");
				current.img.removeClass("media-offload-dragging");
				current.img.setCssProps({ "--media-offload-width": "" });
				e.preventDefault();
				e.stopPropagation();
				if (current.width) this.writeWidth(current.view, current.img, current.width);
			},
			true,
		);

		// Swallow the click that follows a drag so the image doesn't open and the cursor doesn't jump.
		this.registerDomEvent(
			document,
			"click",
			(e) => {
				const img = editorImg(e.target);
				if (img && nearEdge(img, e)) {
					e.preventDefault();
					e.stopPropagation();
				}
			},
			true,
		);
	}

	private writeWidth(view: EditorView, img: HTMLImageElement, width: number): void {
		let pos: number;
		try {
			pos = view.posAtDOM(img);
		} catch {
			new Notice(t().sourceNotFound);
			return;
		}
		const line = view.state.doc.lineAt(pos);
		const text = line.text;
		const sep = /^\s*\|/.test(text) ? "\\|" : "|";
		const base = (s: string): string => {
			try {
				return decodeURIComponent(s.split(/[?#]/)[0]).split("/").pop() ?? s;
			} catch {
				return s;
			}
		};
		const imgName = base(img.getAttribute("src") ?? img.src ?? "");
		const all = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)|!\[\[([^\]|]+)((?:\\?\|[^\]]*)?)\]\]/g)];
		const match =
			all.find((m) => base((m[2] ?? m[3] ?? "").trim().replace(/^<|>$/g, "")) === imgName) ??
			(all.length === 1 ? all[0] : undefined);
		if (!match || match.index === undefined) {
			new Notice(t().sourceNotFound);
			return;
		}
		const next =
			match[2] !== undefined
				? `![${match[1].replace(/\\?\|\s*\d+(x\d+)?\s*$/, "")}${sep}${width}](${match[2]})`
				: `![[${match[3]}${sep}${width}]]`;
		const from = line.from + match.index;
		view.dispatch({ changes: { from, to: from + match[0].length, insert: next } });
	}
}

class MediaOffloadSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: MediaOffloadPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl)
			.setName(t().sFolder)
			.setDesc(t().sFolderDesc(this.plugin.root()))
			.addText((x) =>
				x
					.setPlaceholder("~/Obsidian Media/" + this.app.vault.getName())
					.setValue(s.folder)
					.onChange(async (v) => {
						s.folder = v.trim();
						await save();
					}),
			);

		new Setting(containerEl)
			.setName(t().sPasteDrop)
			.setDesc(t().sPasteDropDesc)
			.addToggle((x) =>
				x.setValue(s.handlePasteDrop).onChange(async (v) => {
					s.handlePasteDrop = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sAutoMove)
			.setDesc(t().sAutoMoveDesc)
			.addToggle((x) =>
				x.setValue(s.autoMoveAttachments).onChange(async (v) => {
					s.autoMoveAttachments = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sDedupe)
			.setDesc(t().sDedupeDesc)
			.addToggle((x) =>
				x.setValue(s.dedupeByContent).onChange(async (v) => {
					s.dedupeByContent = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t().sDragResize)
			.setDesc(t().sDragResizeDesc)
			.addToggle((x) =>
				x.setValue(s.dragResize).onChange(async (v) => {
					s.dragResize = v;
					await save();
				}),
			);

		new Setting(containerEl).setName(t().sTypes).setDesc(t().sTypesDesc).setHeading();
		const exts = (name: string, key: "imageExts" | "videoExts" | "audioExts") =>
			new Setting(containerEl).setName(name).addText((x) =>
				x.setValue(s[key]).onChange(async (v) => {
					s[key] = v;
					await save();
				}),
			);
		exts(t().sImages, "imageExts");
		exts(t().sVideos, "videoExts");
		exts(t().sAudio, "audioExts");
	}
}

