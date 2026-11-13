import { getLanguage } from "obsidian";

const en = {
	cmdMoveCurrent: "Move current attachment out of the vault",
	cmdResize: (label: string) => `Set image width: ${label}`,
	originalSize: "original size",
	moveFailed: (m: string) => `Could not move attachment: ${m}`,
	importFailed: (name: string, m: string) => `Could not import ${name}; the original file was not touched: ${m}`,
	changedWhileCopying: "The source file changed while it was being copied",
	noReferences: "No note links to this attachment, so it was left in place",
	moved: (name: string) => `Moved out of the vault: ${name}`,
	cursorOnImage: "Put the cursor on the line with the image first",
	sourceNotFound: "Could not find this image in the note source",

	sFolder: "Media folder",
	sFolderDesc: (p: string) =>
		`Absolute path outside the vault. ~ means your home folder. Leave empty for the default. Currently: ${p}`,
	sPasteDrop: "Store pasted and dropped media outside the vault",
	sPasteDropDesc: "Media you paste or drop into a note is saved to the media folder and linked, so nothing is added to the vault.",
	sAutoMove: "Move new attachments out of the vault",
	sAutoMoveDesc:
		"When an image or video is created inside the vault and a note links to it, move it to the media folder, update the links and move the vault copy to the trash.",
	sDedupe: "Find duplicates with other names",
	sDedupeDesc:
		"Identical files are always stored once. Turn this on if you also put files in the media folder yourself; it scans the folder (skipping subfolders whose names start with . or _), which is slower when it is large.",
	sDragResize: "Drag to resize images",
	sDragResizeDesc: "Drag the right edge of an image in the editor to set its width.",
	sTypes: "File types",
	sTypesDesc: "Extensions handled by the plugin, separated by commas.",
	sImages: "Images",
	sVideos: "Videos",
	sAudio: "Audio",
};

type Strings = typeof en;

const zh: Strings = {
	cmdMoveCurrent: "把当前附件移出 vault",
	cmdResize: (label) => `调整当前图片宽度：${label}`,
	originalSize: "原始尺寸",
	moveFailed: (m) => `附件整理失败：${m}`,
	importFailed: (name, m) => `导入 ${name} 失败，原文件没动：${m}`,
	changedWhileCopying: "源文件在复制过程中被改动了",
	noReferences: "没有笔记引用这个附件，先不动它",
	moved: (name) => `已移出 vault：${name}`,
	cursorOnImage: "先把光标放到图片所在行",
	sourceNotFound: "没找到图片对应的源码",

	sFolder: "媒体文件夹",
	sFolderDesc: (p) => `vault 外面的绝对路径，~ 代表个人目录；留空用默认位置。当前：${p}`,
	sPasteDrop: "粘贴、拖入的媒体存到 vault 外面",
	sPasteDropDesc: "粘贴或拖进笔记的图片视频直接存到媒体文件夹再引用，vault 里不增加文件。",
	sAutoMove: "把新进 vault 的附件移出去",
	sAutoMoveDesc: "vault 里新出现的图片视频，只要有笔记引用，就搬到媒体文件夹、改好链接，vault 里的那份放进回收站。",
	sDedupe: "按内容查找改过名的重复文件",
	sDedupeDesc: "内容相同的文件本来就只存一份。如果你自己往媒体文件夹里放过文件，打开这项会扫描整个文件夹（跳过以 . 或 _ 开头的子文件夹），文件多时会慢一些。",
	sDragResize: "拖动调整图片大小",
	sDragResizeDesc: "在编辑器里拖图片右边缘就能改宽度。",
	sTypes: "文件类型",
	sTypesDesc: "插件处理的扩展名，用逗号分隔。",
	sImages: "图片",
	sVideos: "视频",
	sAudio: "音频",
};

export const t = (): Strings => (getLanguage().toLowerCase().startsWith("zh") ? zh : en);
