# ByteBridge C++ Rewrite

A collaborative code editor built with Qt 6 and C++. This is a complete rewrite of the original Electron/TypeScript version.

## Features

- **Real-time Collaboration**: Multiple users can edit the same document simultaneously
- **CRDT-based Sync**: Conflict-free document synchronization
- **Presence Awareness**: See other users' cursors and editing status
- **Syntax Highlighting**: Support for 20+ programming languages via QScintilla
- **Deep Linking**: Share collaboration rooms via `myapp://` URLs
- **Cross-Platform**: Works on macOS, Windows, and Linux

## Prerequisites

- **CMake** 3.20+
- **Qt 6.5+** with WebSockets module
- **QScintilla** for Qt 6
- **C++20** compatible compiler

### macOS

```bash
brew install qt@6 qscintilla2
```

### Ubuntu/Debian

```bash
sudo apt install qt6-base-dev qt6-websockets-dev libqscintilla2-qt6-dev
```

### Windows

Install Qt 6 from the [Qt Online Installer](https://www.qt.io/download-qt-installer) and install QScintilla via vcpkg or build from source.

## Building

```bash
# Create build directory
mkdir build && cd build

# Configure with CMake
cmake .. -DCMAKE_PREFIX_PATH=/path/to/qt6

# Build
cmake --build . --config Release

# Run
./ByteBridge  # or ByteBridge.exe on Windows
```

### Using vcpkg (optional)

```bash
cmake .. -DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake
```

## Project Structure

```
cpp/
├── CMakeLists.txt          # Build configuration
├── vcpkg.json              # Package dependencies
├── src/
│   ├── main.cpp            # Application entry point
│   ├── app/
│   │   └── Application.*   # App lifecycle & session management
│   ├── ui/
│   │   ├── MainWindow.*    # Main window UI
│   │   └── NameDialog.*    # Username entry dialog
│   ├── editor/
│   │   └── CodeEditor.*    # QScintilla-based editor
│   ├── collaboration/
│   │   ├── WebSocketClient.*  # WebSocket connection
│   │   ├── CRDTDocument.*     # CRDT sync implementation
│   │   └── Presence.*         # User presence tracking
│   ├── ai/
│   │   └── AIBridger.*     # AI suggestion integration
│   └── utils/
│       ├── DeepLink.*      # Custom URL protocol
│       └── Clipboard.*     # Clipboard utilities
└── resources/
    ├── resources.qrc       # Qt resource file
    ├── styles/
    │   └── main.qss        # Application stylesheet
    └── Info.plist.in       # macOS bundle configuration
```

## Component Mapping

| Original (TypeScript/Electron) | C++ Equivalent                    |
| ------------------------------ | --------------------------------- |
| `main.ts` (Electron main)      | `Application.cpp` + `main.cpp`    |
| `BrowserWindow`                | `MainWindow` (QMainWindow)        |
| Monaco Editor                  | `CodeEditor` (QScintilla)         |
| `y-websocket`                  | `WebSocketClient` (Qt WebSockets) |
| Yjs                            | `CRDTDocument` (simplified CRDT)  |
| `presence.ts`                  | `Presence.cpp`                    |
| `ai-bridger.ts`                | `AIBridger.cpp`                   |
| `renderer.js`                  | Integrated into Qt widgets        |

## Running the Collaboration Server

The C++ version uses the same Yjs WebSocket server as the original. Run it with:

```bash
# From the original project root
npm run server
```

Or with Docker:

```bash
docker run -p 1234:1234 yjs/y-websocket
```

## Configuration

Settings are stored using Qt's QSettings:

- **macOS**: `~/Library/Preferences/com.bytebridge.app.plist`
- **Windows**: Registry `HKEY_CURRENT_USER\Software\ByteBridge`
- **Linux**: `~/.config/ByteBridge/ByteBridge.conf`

## License

MIT
