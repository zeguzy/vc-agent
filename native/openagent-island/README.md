# openagent-island

Native macOS menubar app that displays Dynamic Island–style notifications from [openagent](../../).

Subscribes to openagent's SSE notification stream and renders a pill-shaped panel near the MacBook notch.

## Build & Run

```bash
cd native/openagent-island
swift build
swift run

# Custom port (default: 3000)
OPENAGENT_PORT=8080 swift run
```

Or open `Package.swift` in Xcode and press Run.

## Architecture

```
openagent (Bun)                       openagent-island (Swift)
┌──────────────────────┐              ┌──────────────────────────┐
│ NotificationRouter    │              │ SSEClient                 │
│   notify()            │              │   GET /sse/notifications  │
│     ↓                 │              │   ← SSE stream            │
│ NotificationBus       │──SSE stream─→│     ↓                     │
│   emit(payload)       │              │   NotchPanel              │
│     ↓                 │              │     pill @ notch          │
│  SSE endpoint         │              │     color-coded           │
│  GET /sse/notifications│             │     auto-dismiss 4s       │
└──────────────────────┘              └──────────────────────────┘
```

## Event Protocol (SSE)

```
GET http://127.0.0.1:{port}/sse/notifications
Content-Type: text/event-stream

data: {"event":"toolError","title":"openagent","message":"bash 失败"}

data: {"event":"needsInput","title":"openagent","message":"等待回复"}
```

| event          | icon | color  |
|----------------|------|--------|
| toolError      | ✕    | red    |
| longBash       | ⏱    | cyan   |
| needsInput     | ?    | yellow |
| compactionEnd  | ✓    | green  |
| agentEnd       | ◆    | blue   |

## Environment

| Variable         | Default | Description                     |
|------------------|---------|---------------------------------|
| `OPENAGENT_PORT` | `4096`  | Port of the openagent SSE server |

## Requirements

- macOS 13+ (notch detection via `safeAreaInsets`)
- Swift 5.9+
- openagent running in serve mode
