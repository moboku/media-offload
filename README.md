# Media Offload

**Keep your vault small.** Images and videos you paste or drop into a note are saved to a folder *outside* the vault and linked from the note. Nothing is added to the vault, so it stays fast to sync, back up and version with Git.

[中文说明](#中文说明)

## Features

- **Paste and drop go outside the vault.** The file is copied to your media folder and an embed is inserted at the cursor: `![](file:///…)` for images, a `<video>` player for videos.
- **Identical files are stored once.** Files are named by their SHA-256 hash, so pasting the same screenshot twice keeps one copy.
- **Attachments that still land in the vault are moved out.** When another plugin, a capture prompt or a manual copy creates an image or video inside the vault and a note links to it, the plugin moves it to the media folder, rewrites the links and puts the vault copy in the trash. You can also run **Move current attachment out of the vault** on an open attachment.
- **Resize images in the editor.** Drag the right edge of an image, or use the **Set image width** commands (240 / 400 / 600 px / original).

## Settings

| Setting | Default |
| --- | --- |
| Media folder | `~/Obsidian Media/<vault name>` |
| Store pasted and dropped media outside the vault | On |
| Move new attachments out of the vault | On |
| Find duplicates with other names | Off. Turn this on if you put files in the media folder yourself. |
| Drag to resize images | On |
| File types | png, jpg, jpeg, gif, webp, avif, svg, heic · mp4, mov, m4v, webm. Audio is off by default. |

## Before you use it

- **Desktop only.** The plugin writes to your file system.
- **Links are absolute `file://` paths.** Media shows up on this computer, and on another computer only if the media folder sits at the same path. It does not show on mobile.
- **Sync and backup don't cover the media folder.** Obsidian Sync, iCloud or Git syncing the vault won't copy it. Back it up yourself, or put it in a folder that is already backed up.
- Moving an attachment out only rewrites links that Obsidian resolves to that exact file. If something fails partway, the notes it already changed are restored and the original file is left in place.

## Install

Until it's in the community plugin list, copy `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases) into `<vault>/.obsidian/plugins/media-offload/`, then enable **Media Offload** in **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
```

## License

MIT

---

## 中文说明

**让 vault 不再变大。** 粘贴或拖进笔记的图片、视频直接存到 vault **外面**的文件夹，笔记里只放引用。vault 里一个文件都不加，同步、备份、用 Git 管理都轻松。

- **粘贴、拖入直接存外面**：文件复制到媒体文件夹，在光标处插入引用。图片是 `![](file:///…)`，视频是 `<video>` 播放器。
- **相同文件只存一份**：用 SHA-256 哈希当文件名，同一张截图粘两次也只存一份。
- **进了 vault 的附件自动搬出去**：别的插件、快速记录框或手动复制进来的图片视频，只要有笔记引用，就搬到媒体文件夹、改好链接，vault 里的那份放进回收站。也可以对打开的附件运行「把当前附件移出 vault」。
- **编辑器里调图片大小**：拖图片右边缘，或用「调整当前图片宽度」命令（240 / 400 / 600 px / 原始尺寸）。

**使用前请注意**

- 只支持桌面端。
- 链接是绝对路径 `file://`。在这台电脑上能显示；换一台电脑，要媒体文件夹路径相同才能显示；手机上看不到。
- 同步 vault 的工具（Obsidian Sync、iCloud、Git）不会同步媒体文件夹，请自己备份，或者放在已经有备份的位置。
