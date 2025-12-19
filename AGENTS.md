# Clueless - Project Guide

## Overview

Clueless is an Electron desktop app that provides an invisible AI assistant overlay for meetings, interviews, and presentations. It uses Groq API for LLM capabilities and Supermemory for document storage/retrieval.

## Quick Start

```bash
# Development mode (starts Vite + Electron concurrently)
pnpm start

# Or equivalently
pnpm run app:dev

# Build for production
pnpm run dist
```

## Project Structure

```
free-cluely/
├── electron/           # Electron main process
│   ├── main.ts         # App entry, window management, AppState
│   ├── preload.ts      # IPC bridge - defines ElectronAPI interface
│   ├── ipcHandlers.ts  # IPC handler implementations
│   ├── LLMHelper.ts    # Groq API wrapper
│   ├── ProcessingHelper.ts  # Orchestrates LLM + Supermemory
│   ├── SupermemoryHelper.ts # Supermemory API wrapper
│   ├── ScreenshotHelper.ts  # Screenshot capture
│   └── shortcuts.ts    # Global keyboard shortcuts
├── src/                # React renderer process
│   ├── _pages/         # Main views (Queue.tsx, Solutions.tsx)
│   ├── components/     # UI components
│   │   ├── Queue/      # Queue-specific components
│   │   └── ui/         # Shared UI components
│   ├── index.css       # Global styles (prose-glass, prose-dark)
│   └── vite-env.d.ts   # TypeScript declarations for ElectronAPI
└── dist-electron/      # Compiled Electron code
```

## Key Patterns

### 1. Electron API (IPC Communication)

**DO NOT use generic `invoke()`**. Use typed methods on `window.electronAPI`:

```typescript
// CORRECT - Use typed methods
const response = await window.electronAPI.groqChat(message);
const config = await window.electronAPI.getCurrentLlmConfig();
const result = await window.electronAPI.analyzeImageFile(path);

// WRONG - Don't use generic invoke
const response = await window.electronAPI.invoke("groq-chat", message);
```

All API methods are defined in:

- `electron/preload.ts` - Implementation and ElectronAPI interface
- `src/vite-env.d.ts` - TypeScript declarations for renderer process

### 2. Adding New IPC Handlers

1. Add handler in `electron/ipcHandlers.ts`:

```typescript
ipcMain.handle("my-handler", async (_event, arg: string) => {
  return await appState.processingHelper.myMethod(arg);
});
```

2. Expose in `electron/preload.ts`:

```typescript
// In ElectronAPI interface
myMethod: (arg: string) => Promise<ReturnType>;

// In contextBridge.exposeInMainWorld
myMethod: (arg: string) => ipcRenderer.invoke("my-handler", arg),
```

3. Add types in `src/vite-env.d.ts`:

```typescript
interface ElectronAPI {
  myMethod: (arg: string) => Promise<ReturnType>;
}
```

### 3. Views

The app has two views controlled by `setView` state in `App.tsx`:

- `"queue"` - Main view with screenshot queue, chat, settings panels
- `"solutions"` - Solution display view

### 4. Dark Theme UI Pattern

All panels use consistent dark theme styling:

```tsx
// Container
className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4"

// Text colors
className="text-white/90"     // Primary text
className="text-white/70"     // Secondary text
className="text-white/40"     // Muted text

// Buttons
className="bg-white/10 hover:bg-white/20 border border-white/20"

// Inputs
className="bg-white/10 text-white border border-white/20 focus:border-white/40"

// For markdown in dark containers, use variant="glass" (white text)
<MarkdownRenderer content={text} variant="glass" />

// variant="dark" is for LIGHT backgrounds (dark text)
```

### 5. Panel Toggle Pattern

Panels (Settings, Customize, Help, Chat) toggle open/closed and close each other:

```typescript
const handleMyPanelToggle = () => {
  setIsMyPanelOpen(!isMyPanelOpen);
  if (!isMyPanelOpen) {
    setIsOtherPanelOpen(false);
    // Close other panels...
  }
};
```

## Key Files

| File                                   | Purpose                                        |
| -------------------------------------- | ---------------------------------------------- |
| `electron/main.ts`                     | App lifecycle, window creation, AppState class |
| `electron/preload.ts`                  | IPC bridge, ElectronAPI interface definition   |
| `electron/ipcHandlers.ts`              | All IPC handler implementations                |
| `electron/ProcessingHelper.ts`         | LLM orchestration, memory context              |
| `src/_pages/Queue.tsx`                 | Main queue view with chat interface            |
| `src/components/ui/CustomizePanel.tsx` | User customization panel                       |
| `src/vite-env.d.ts`                    | Global TypeScript types for renderer           |

## Keyboard Shortcuts

| Shortcut    | Action                    |
| ----------- | ------------------------- |
| Cmd+B       | Toggle window visibility  |
| Cmd+Shift+H | Take screenshot           |
| Cmd+Enter   | Solve/Process screenshots |
| Cmd+R       | Reset/Start over          |
| Cmd+K       | Focus chat input          |

## Environment Variables

Create `.env` file in root:

```
GROQ_API_KEY=your_groq_api_key
SUPERMEMORY_API_KEY=your_supermemory_api_key  # Optional, for personalization
```

## CSS Classes

- `prose-glass` - White text for dark backgrounds (use in chat)
- `prose-dark` - Dark text for light backgrounds (naming is confusing)
- `draggable-area` - Makes element draggable for window movement
