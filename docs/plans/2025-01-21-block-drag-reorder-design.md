# Block Drag-to-Reorder Design

## Overview

Add drag-to-reorder functionality for blocks using the existing settings button (hamburger icon) as the drag handle. Blocks can be reordered by dragging them to new positions, with a visual indicator showing the drop target.

## Behavior

- **Click** on settings button still opens block tunes (existing behavior preserved)
- **Drag** gesture initiates block reorder
- During drag:
  - Original block stays in place with reduced opacity (0.4)
  - Browser's default drag ghost shows the dragged content
  - A 3px solid blue horizontal line indicates the drop position
- Drop indicator appears based on cursor position:
  - Cursor in top half of a block → line appears above that block
  - Cursor in bottom half of a block → line appears below that block

## Module Structure

### New Module: `BlockDrag`

Location: `src/components/modules/blockDrag.ts`

**Responsibilities:**
- Make settings button draggable
- Track drag state (which block is being dragged)
- Calculate drop target based on cursor position
- Show/hide drop indicator line
- Execute block move on drop

**Integration points:**
- `Toolbar` module — access to settings button element
- `BlockManager` module — get block references, call `move()`
- `UI` module — access to editor holder for event listeners
- `Blocks` collection — uses existing `move(toIndex, fromIndex)` method

**State:**
- `draggedBlock: Block | null` — the block being moved
- `dropTargetIndex: number | null` — where it would be inserted
- Drop indicator element reference

## Drag Interaction Flow

### 1. Drag Start (on settings button)
- Set `draggable="true"` on settings button
- On `dragstart`:
  - Store reference to the block being dragged
  - Set `dataTransfer.setData('editor/block-drag', blockId)` to identify as block drag
  - Set `dataTransfer.effectAllowed = 'move'`
  - Apply `opacity: 0.4` to the dragged block's holder
  - Create/show the drop indicator

### 2. During Drag (`dragover` on editor holder)
- Prevent default (allows drop)
- Use `document.elementFromPoint()` to find block under cursor
- Determine if cursor is in top or bottom half of that block
- Position indicator accordingly
- Update `dropTargetIndex`

### 3. Drop
- Prevent default
- If `dropTargetIndex` differs from current block position:
  - Call `BlockManager.move(dropTargetIndex, fromIndex)`
- Clean up: hide indicator, restore opacity, clear state

### 4. Drag End/Cancel
- Restore dragged block opacity
- Hide indicator
- Clear all drag state

## Visual Styling

### Drop Indicator
```css
.ce-block-drag-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: #388AE5;
  pointer-events: none;
  max-width: var(--content-width);
  margin: 0 auto;
  display: none;
}

.ce-block-drag-indicator--visible {
  display: block;
}
```

### Dragged Block
```css
.ce-block--dragging {
  opacity: 0.4;
}
```

### Drag Handle Cursor
```css
.ce-toolbar__settings-btn {
  cursor: grab;
}

.ce-toolbar__settings-btn:active {
  cursor: grabbing;
}
```

## Edge Cases

- **Single block**: Drag allowed (no-op if dropped in same position)
- **Read-only mode**: Dragging disabled (consistent with existing toolbar behavior)
- **Drag outside editor**: Cancel drag, snap back

## Files to Modify

1. `src/components/modules/blockDrag.ts` — new module
2. `src/components/modules/index.ts` — register new module
3. `src/types-internal/editor-modules.d.ts` — add type declaration
4. `src/styles/toolbar.css` — add drag-related styles
5. `src/components/modules/toolbar/index.ts` — expose settings button reference

## Compatibility

The existing `DragNDrop` module (handles external content drops) remains unchanged. It processes drops via the Paste module and will ignore our block-drag operations since we use a custom data type (`editor/block-drag`).
