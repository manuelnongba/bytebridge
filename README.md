# ByteBridge

ByteBridge is a collaborative code editor desktop application built with Electron for real-time collaborative editing.

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

To extend detection and the language dropdown, edit [the language registry](src/renderer/debugging/languages.js), then rebuild. File contents remain editable local drafts until reviewed and explicitly shared.
