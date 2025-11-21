# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Editor.js is an open-source block-style WYSIWYG text editor that outputs clean JSON instead of HTML. Each block type (paragraph, heading, image, etc.) is provided via separate plugins, making the editor highly extensible.

## Development Commands

```bash
# Development server
yarn serve

# Build for production
yarn build

# Linting (runs both eslint and tsc --noEmit)
yarn lint
yarn lint:fix

# Unit tests (Vitest)
yarn test:unit
yarn test:unit:watch

# E2E tests (Playwright)
yarn test:e2e
yarn test:e2e:ui

# Run a single test file
npx vitest run test/unit/path/to/test.test.ts
npx playwright test test/playwright/tests/path/to/test.spec.ts
```

## Architecture

### Entry Point & Core Bootstrap

- `src/codex.ts` - Main `EditorJS` class exported to users. Wraps Core and exports the public API.
- `src/components/core.ts` - Bootstrap class that initializes all modules and manages editor lifecycle.

### Module System

All functionality is organized into **modules** that inherit from the base `Module` class (`src/components/__module.ts`). Modules have access to:
- `this.Editor` - References to all other module instances
- `this.config` - Editor configuration
- `this.eventsDispatcher` - Event bus for cross-module communication
- `this.listeners` / `this.readOnlyMutableListeners` - DOM event listener management

Modules are registered in `src/components/modules/index.ts` and fall into categories:

**Core Modules** (`src/components/modules/`):
- `BlockManager` - Block CRUD operations, current block tracking
- `BlockEvents` - Keyboard event handling (Enter, Backspace, Tab, arrows)
- `BlockSelection` - Multi-block selection state
- `BlockDrag` - Block drag-and-drop handling
- `Caret` - Caret positioning within and across blocks
- `UI` - Main DOM structure, empty state, mobile layout detection
- `Paste` - Clipboard paste handling and processing
- `Renderer` - Initial blocks rendering from data
- `Saver` - Output data collection from blocks
- `Tools` - Tool class loading and configuration
- `ReadOnly` - Read-only mode toggling

**Toolbar Modules** (`src/components/modules/toolbar/`):
- `Toolbar` - Main toolbar container
- `BlockSettings` - Block settings popover (tunes menu)
- `InlineToolbar` - Text selection formatting toolbar

**API Modules** (`src/components/modules/api/`):
- Provide the public API surface (`editor.blocks`, `editor.caret`, etc.)

### Block & Tool System

**Block** (`src/components/block/index.ts`):
- Represents a single content block in the editor
- Wraps a Tool instance with its data and tunes
- Manages block-level state (selected, focused, etc.)

**Tool Adapters** (`src/components/tools/`):
- `base.ts` - Base adapter for all tool types
- `block.ts` - Block tool adapter (content blocks like Paragraph, Heading)
- `inline.ts` - Inline tool adapter (formatting like Bold, Link)
- `tune.ts` - Block tune adapter (block-level actions like Move, Delete)
- `collection.ts` - ToolsCollection class for tool storage

### Key Utilities

- `src/components/dom.ts` - DOM manipulation utilities (aliased as `$`)
- `src/components/utils.ts` - General utilities (aliased as `_`)
- `src/components/selection.ts` - Selection/Range utilities
- `src/components/utils/popover/` - Popover component system (used by toolbox, block tunes, inline toolbar)

### Type Definitions

- `types/` - Public TypeScript declarations (shipped with package)
- `src/types-internal/` - Internal type definitions

### Test Structure

- `test/unit/` - Unit tests (Vitest + jsdom), mirror src structure
- `test/playwright/` - E2E tests with Playwright

## Code Policies

**Do not modify configuration files** (vite.config.ts, tsconfig.json, .eslintrc, package.json, etc.) unless explicitly instructed.

**Fix problems properly** - Never suppress TypeScript errors with `@ts-ignore` or `any`. Refactor to fix the root cause. Run `yarn lint` to verify fixes.
