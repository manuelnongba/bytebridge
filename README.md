# ByteBridge

ByteBridge is a collaborative code editor desktop application built with Electron for real-time collaborative editing.

## The workflow

Rooms open directly into the editor. The two main panels are **Files** and **Problem**; the existing Open/Solved badge stays visible.

- **Files:** share a project or subfolder, navigate files, and edit together. Owners and editors can both share their own folders.
- **Problem:** describe **What’s wrong?** and **What should happen?** Optional reproduction steps, logs, issue links, and snippets are tucked under **Optional details & snippets**. Drafts stay local until **Save & share problem**; there is no separate review/publish step. Remove sensitive information before saving.
- **Save checkpoint:** capture the currently loaded shared buffers with one click. Under **History & checkpoints**, choose two snapshots to compare or review/redact a Markdown export before saving it.
- **Mark solved:** optionally add **What fixed it?** and confirm. This is participant-reported, not automatic verification. **Reopen problem** retains previous notes and checkpoints.

## Getting Started

### Installation

Install dependencies:

```sh
npm ci
```

### Development

Start the collaboration server in a separate terminal first (`npm run server`). Then build and launch in development mode:

```sh
npm run build
npm run dev
```

To watch renderer and preload changes (reload/restart the app manually; main-process changes need a separate rebuild):

```sh
npm run watch
```

### Collaborative Server

To start the Yjs websocket server for collaboration:

```sh
npm run server
```

### Multiple Sessions on One Device

Build once:

```sh
npm run build
```

Keep one collaboration server running in terminal 1:

```sh
npm run server
```

Launch separate profiles in terminals 2 and 3:

```sh
# Terminal 2
npm run dev -- --profile alice
```

```sh
# Terminal 3
npm run dev -- --profile bob
```

Create a room in Alice, copy its invitation, and paste it into **Join room** in Bob. Choose different display names to test typing indicators and collaboration.

Each profile has a labeled window and separate saved rooms, credentials, and settings that persist across restarts. Reusing the same profile name focuses its existing instance; use different names for simultaneous sessions. The ordinary `npm run dev` profile remains unchanged. Paste invitations into the intended window rather than relying on OS link routing to choose a profile.

### Attachment Language Detection

Selected files and named snippets support 40 language/file types, including JavaScript/JSX, TypeScript/TSX, Python, Java, C/C++, C#, Go, Rust, Ruby, PHP, Swift, Kotlin, SQL, YAML, TOML, Markdown, Vue, and Svelte. Special filenames such as `Dockerfile`, `Makefile`, and `CMakeLists.txt` are also recognized.

Detection uses filenames and extensions, including uppercase variants. Unknown types fall back to plaintext. Entering a snippet filename updates its language automatically; explicitly choosing a language overrides detection. These labels describe reference attachments, not additional code-execution support.

To extend detection and the language dropdown, edit [the language registry](src/renderer/debugging/languages.ts), then rebuild. Snippets remain editable local drafts until you choose **Save & share problem**.

### Debugging a Project Together

1. Join a room and enter the editor. Open **Files → Share project…**.
2. Choose a project folder (or a smaller subfolder) and confirm the sharing scope once. There is no per-file review or copy-creation step. Use **Add snippet** under **Problem → Edit problem → Optional details & snippets** when you only want to share selected details.
3. The room receives the file tree, not all file contents. Opening a file loads its UTF-8 text from the hosting desktop. Teammates can open different files and see who is viewing or editing each one.
4. Edit together in the shared buffers. The host sees **Unsaved to project** when a buffer differs from its last read/save. Edits do **not** automatically write to disk. The host uses **Save to project** to update that original file; other participants cannot invoke that host's native save capability.
5. If another editor or Git changed the file since it was read, saving is blocked. Use **Save copy…** to a different destination and merge externally. Do not select the original file as the copy destination if you want to preserve the conflict.

The folder host is whoever selected that folder, not necessarily the room owner. **Stop hosting** releases all folders hosted by this window. Already loaded buffers remain usable; unopened files need their host online. Brief network interruptions reconnect within the same app session. Leaving the room, reloading, or closing the app releases native access. Sharing again creates a new scope; this version does not automatically reattach old buffers or refresh the catalog when files are added/renamed/deleted on disk.

Privacy: relative file names are shared at confirmation. Any room participant can request a listed file while the host is online. Loaded contents persist in room storage and may enter checkpoints/exports; stopping hosting does not recall previously shared content. `.gitignore` rules inside the chosen scope, common credentials, dependency/build directories, symlinks, and hard-linked files are excluded. This is not a secret scanner—choose the scope carefully. Checkpoints freeze **Shared code and loaded buffers only**, never the entire unopened project.

Save safety uses content hashes and file identity/mtime checks before an atomic replacement. It detects ordinary external edits but is not a cross-process filesystem lock; avoid simultaneous disk writes from other tools during a save. There is no automatic execution of project code.

Configuration lives in [APP_CONFIG.workspace](src/renderer/app-config.ts): enable/disable the feature, catalog size, per-file/loaded-room budgets, and request timeout. Defaults are 2,000 files, 256 KiB per file, 2 MiB of loaded text, and a 15-second load timeout. [PROJECT_POLICY](src/main/project-files.ts) independently caps native scans and reads (50,000 scanned entries, 30 directory levels, four hosted folders per window enforced by main). Raising renderer limits alone does not bypass native safety limits. Checkpoint size/history limits remain under `APP_CONFIG.timeline`; large loaded workspaces may exceed the checkpoint budget. The collaboration server accepts up to 8 MiB per WebSocket message, including synchronization history; that is not an unlimited room-storage quota. Restart/redeploy the updated server alongside this app update.

Validation: `npm test` covers scope filtering, lazy reads, safe writes, collaboration data, and checkpoints. `npm run test:desktop` exercises two isolated Electron windows, native-dialog cancellation/confirmation, independent tabs, two-way edits, explicit save/conflicts, host offline behavior, and restart persistence. These local checks do not substitute for testing two physical computers on separate networks.
