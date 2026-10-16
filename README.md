# ByteBridge

A collaborative desktop code editor for debugging together, built with Electron. Share a project, edit in real time, track the problem, and get an AI catch-up when you need it.

## What you can do

- **Files:** share a folder, browse files, and edit together. Files load as they are opened; the folder host saves changes explicitly with **Save to project**.
- **Problem:** share the issue, expected behavior, logs, and snippets. Track attempts, mark the problem solved, or reopen it later.
- **Checkpoints:** capture loaded shared code, open snapshots in read-only editor tabs, compare versions, and export history as Markdown.
- **Catch me up:** generate a short summary and suggested next steps from session context, with links to the evidence used.
- **Saved sessions:** search and resume rooms, with separate profiles for different identities.

## Get started

Requires Node.js 22 and npm.

```sh
npm ci
cp .env.example .env
npm run server
```

In another terminal, build and launch the desktop app:

```sh
npm run build
npm run dev
```

Create a room and share its invitation. Collaborators join through **Join room** and need access to the same collaboration server.

For two local windows, run these in separate terminals:

```sh
npm run dev -- --profile alice
npm run dev -- --profile bob
```

Each profile keeps its own saved rooms and settings.

## Working together

Open **Files → Share project…** and choose a folder or subfolder. The host must stay online to load unopened files. Shared edits stay in room buffers until the host saves them to disk.

If disk contents change externally, ByteBridge opens a **Disk ↔ Room** comparison before saving. Review the versions and use the recovery controls to export or reload as needed. Checkpoints capture loaded shared buffers, not the entire project.

Use **Problem → Edit problem** to describe the issue and add supporting details, then **Save & share problem**. Save checkpoints as you investigate and mark the problem solved when finished.

Choose sharing scope carefully: file names and requested contents become available to the room. Ignore rules exclude common sensitive and generated files, but are not a secret scanner. Stopping hosting or removing a shared project does not erase earlier copies or checkpoints; removing a project leaves disk files intact.

## Optional AI catch-up

Set these values in the collaboration server's `.env`, then restart `npm run server`:

```dotenv
AI_ENABLED=1
OPENROUTER_API_KEY=<your OpenRouter API key>
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```

Open **Problem → Catch me up** for **At a glance** and **Try next**. Additional details and source references can be expanded. **Refresh catch-up** generates an updated summary; results remain local to the current window and are not saved to shared history.

Generating a catch-up sends shared Problem details, recent history, snippets, and loaded code to OpenRouter and its serving provider. Keep the API key on the server. Request limits are configurable in `.env.example`; set an OpenRouter key spending limit to control costs. AI is optional and disabled by default.

## Shortcuts

| Action                               | Shortcut             |
| ------------------------------------ | -------------------- |
| Commands                             | Command/Ctrl+Shift+P |
| Find a file                          | Command/Ctrl+P       |
| Save to project                      | Command/Ctrl+S       |
| Add selected code to a Problem draft | Command/Ctrl+Shift+A |

## Development

- `npm run watch` — rebuild renderer/preload changes; reload the app manually.
- `npm run build` — rebuild the full app, including the main process.
- `npm run typecheck` — check app TypeScript types.
- `npm test` — run automated tests.
- `npm run test:desktop` — exercise Electron collaboration workflows.

Configure appearance, shortcuts, and workspace limits in [app-config.ts](src/renderer/app-config.ts). Server settings are listed in [.env.example](.env.example).
