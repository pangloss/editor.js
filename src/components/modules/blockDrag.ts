import Module from '../__module';
import $ from '../dom';
import type Block from '../block';
import * as tooltip from '../utils/tooltip';

/**
 * HTML Elements used for BlockDrag UI
 */
interface BlockDragNodes {
  indicator: HTMLElement | undefined;
}

/**
 * @class BlockDrag
 * @classdesc Module for drag-to-reorder blocks
 */
export default class BlockDrag extends Module<BlockDragNodes> {
  /**
   * CSS classes
   */
  private get CSS(): { [name: string]: string } {
    return {
      indicator: 'ce-block-drag-indicator',
      indicatorVisible: 'ce-block-drag-indicator--visible',
      blockDragging: 'ce-block--dragging',
    };
  }

  /**
   * The blocks currently being dragged
   */
  private draggedBlocks: Block[] = [];

  /**
   * Index where the blocks would be dropped
   */
  private dropTargetIndex: number | null = null;

  /**
   * Public flag to indicate if a drag is in progress
   * Used by Toolbar to prevent opening tunes during drag
   */
  public isDragging = false;

  /**
   * Toggle read-only state
   *
   * @param readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (readOnlyEnabled) {
      this.disableModuleBindings();
    } else {
      this.enableModuleBindings();
    }
  }

  /**
   * Create drop indicator element
   */
  private createIndicator(): void {
    this.nodes.indicator = $.make('div', this.CSS.indicator);
    this.Editor.UI.nodes.wrapper.appendChild(this.nodes.indicator);
  }

  /**
   * Enable drag event bindings
   */
  private enableModuleBindings(): void {
    /**
     * Wait for toolbar to be ready, since it's created in requestIdleCallback.
     * We use setTimeout to retry if toolbar isn't ready yet, ensuring we don't
     * miss the setup due to race conditions between requestIdleCallback calls.
     */
    const trySetup = (): void => {
      const settingsButton = this.Editor.Toolbar.nodes.settingsToggler;

      if (!settingsButton) {
        /**
         * Toolbar not ready yet, retry after a short delay
         */
        setTimeout(trySetup, 100);

        return;
      }

      this.setupDragHandle();
      this.createIndicator();
      this.setupDropZone();
    };

    window.requestIdleCallback(() => {
      trySetup();
    }, { timeout: 2000 });
  }

  /**
   * Disable drag event bindings
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();

    if (this.nodes.indicator) {
      this.nodes.indicator.remove();
      this.nodes.indicator = undefined;
    }
  }

  /**
   * Setup the settings button as a drag handle
   */
  private setupDragHandle(): void {
    const { Toolbar } = this.Editor;
    const settingsButton = Toolbar.nodes.settingsToggler;

    if (!settingsButton) {
      return;
    }

    settingsButton.setAttribute('draggable', 'true');

    /**
     * Set isDragging on mousedown BEFORE dragstart fires.
     * This prevents selection from being cleared by documentClicked handler.
     */
    this.readOnlyMutableListeners.on(settingsButton, 'mousedown', () => {
      this.isDragging = true;
    });

    /**
     * Reset isDragging on mouseup if no drag actually started.
     * This handles the case where user clicks without dragging.
     */
    this.readOnlyMutableListeners.on(settingsButton, 'mouseup', () => {
      /**
       * If draggedBlocks is empty, no drag started - reset the flag
       */
      if (this.draggedBlocks.length === 0) {
        this.isDragging = false;
      }
    });

    this.readOnlyMutableListeners.on(settingsButton, 'dragstart', (event: DragEvent) => {
      this.onDragStart(event);
    });

    this.readOnlyMutableListeners.on(settingsButton, 'dragend', () => {
      this.onDragEnd();
    });
  }

  /**
   * Setup the editor as a drop zone
   */
  private setupDropZone(): void {
    const { holder } = this.Editor.UI.nodes;

    this.readOnlyMutableListeners.on(holder, 'dragover', (event: DragEvent) => {
      this.onDragOver(event);
    });

    this.readOnlyMutableListeners.on(holder, 'drop', (event: DragEvent) => {
      this.onDrop(event);
    });

    this.readOnlyMutableListeners.on(holder, 'dragleave', (event: DragEvent) => {
      this.onDragLeave(event);
    });
  }

  /**
   * Handle drag start
   *
   * @param event - dragstart event
   */
  private onDragStart(event: DragEvent): void {
    const { Toolbar, BlockSelection } = this.Editor;

    /**
     * Mark that a drag is in progress
     */
    this.isDragging = true;

    /**
     * Hide tooltip immediately
     */
    tooltip.hide(true);

    /**
     * Get the block that the toolbar is currently hovering over
     */
    const hoveredBlock = (Toolbar as any).hoveredBlock as Block | undefined;

    if (!hoveredBlock) {
      event.preventDefault();

      return;
    }

    /**
     * If multiple blocks are selected, drag all of them.
     * Otherwise, just drag the hovered block.
     */
    const selectedBlocks = BlockSelection.selectedBlocks;

    if (selectedBlocks.length > 1 && selectedBlocks.includes(hoveredBlock)) {
      this.draggedBlocks = selectedBlocks;
    } else {
      this.draggedBlocks = [hoveredBlock];
    }

    /**
     * Set data transfer to identify this as a block drag
     */
    if (event.dataTransfer) {
      event.dataTransfer.setData('editor/block-drag', this.draggedBlocks.map(b => b.id).join(','));
      event.dataTransfer.effectAllowed = 'move';
    }

    /**
     * Apply dragging style to all dragged blocks
     */
    this.draggedBlocks.forEach(block => {
      block.holder.classList.add(this.CSS.blockDragging);
    });

    /**
     * Show indicator
     */
    this.showIndicator();
  }

  /**
   * Handle drag over - position the indicator
   *
   * @param event - dragover event
   */
  private onDragOver(event: DragEvent): void {
    /**
     * Only handle our block drags
     */
    if (this.draggedBlocks.length === 0) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    const { BlockManager } = this.Editor;
    const blocks = BlockManager.blocks;

    if (blocks.length === 0) {
      return;
    }

    const cursorY = event.clientY;

    /**
     * Find the target block based on vertical position only.
     * This allows dragging to work even when cursor is off to the side.
     */
    let targetBlock = blocks[0];
    let targetIndex = 0;
    let isTopHalf = true;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const rect = block.holder.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (cursorY >= rect.top && cursorY < rect.bottom) {
        /**
         * Cursor is within this block's vertical bounds
         */
        targetBlock = block;
        targetIndex = i;
        isTopHalf = cursorY < midpoint;
        break;
      } else if (cursorY < rect.top) {
        /**
         * Cursor is above this block - use previous block or first block
         */
        targetBlock = i > 0 ? blocks[i - 1] : block;
        targetIndex = i > 0 ? i - 1 : 0;
        isTopHalf = i === 0;
        break;
      } else if (i === blocks.length - 1) {
        /**
         * Cursor is below the last block
         */
        targetBlock = block;
        targetIndex = i;
        isTopHalf = false;
      }
    }

    /**
     * Calculate drop index
     * - Top half: insert before target block
     * - Bottom half: insert after target block
     */
    this.dropTargetIndex = isTopHalf ? targetIndex : targetIndex + 1;

    /**
     * Position the indicator
     */
    this.positionIndicator(targetBlock.holder, isTopHalf);
  }

  /**
   * Handle drag leave
   *
   * @param event - dragleave event
   */
  private onDragLeave(event: DragEvent): void {
    /**
     * Only hide if we're actually leaving the editor (not entering a child)
     */
    const relatedTarget = event.relatedTarget as Node | null;
    const holder = this.Editor.UI.nodes.holder;

    if (relatedTarget && holder.contains(relatedTarget)) {
      return;
    }

    this.hideIndicator();
  }

  /**
   * Handle drop
   *
   * @param event - drop event
   */
  private onDrop(event: DragEvent): void {
    /**
     * Only handle our block drags
     */
    if (this.draggedBlocks.length === 0 || this.dropTargetIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { BlockManager } = this.Editor;

    /**
     * Sort dragged blocks by their current position (top to bottom)
     */
    const sortedBlocks = [...this.draggedBlocks].sort((a, b) => {
      return BlockManager.blocks.indexOf(a) - BlockManager.blocks.indexOf(b);
    });

    const firstDraggedIndex = BlockManager.blocks.indexOf(sortedBlocks[0]);
    const targetIndex = this.dropTargetIndex;

    /**
     * Calculate the effective target index after the dragged blocks are removed.
     * For each dragged block that is BEFORE the target, the target shifts down by 1.
     */
    const blocksBeforeTarget = sortedBlocks.filter(
      block => BlockManager.blocks.indexOf(block) < targetIndex
    ).length;

    const effectiveTarget = targetIndex - blocksBeforeTarget;

    /**
     * Determine if we're moving up or down
     */
    const isMovingUp = firstDraggedIndex > effectiveTarget;
    const isMovingDown = firstDraggedIndex < effectiveTarget;
    const positionChanged = isMovingUp || isMovingDown;

    if (positionChanged) {
      if (isMovingUp) {
        /**
         * Moving UP: Process from top to bottom (first block in selection first)
         * Each block is inserted at effectiveTarget + offset
         * Example: blocks at [3,4,5] moving to position 1
         *   - Block at 3 moves to 1 → indices shift, next block now at 3
         *   - Block at 3 moves to 2 → indices shift, next block now at 3
         *   - Block at 3 moves to 3 → done
         */
        for (let i = 0; i < sortedBlocks.length; i++) {
          const block = sortedBlocks[i];
          const fromIndex = BlockManager.blocks.indexOf(block);

          BlockManager.move(effectiveTarget + i, fromIndex);
        }
      } else {
        /**
         * Moving DOWN: Process from bottom to top (last block in selection first)
         * Each block is inserted at effectiveTarget - 1 (since we're inserting BEFORE)
         * Example: blocks at [1,2,3] moving to position 6 (effectiveTarget = 3)
         *   - Block at 3 moves to 3 → no change in position but now after other blocks shift
         *   - Block at 2 moves to 3 →
         *   - Block at 1 moves to 3 →
         *
         * Actually simpler: move each to (effectiveTarget - 1) since array shrinks from top
         */
        for (let i = sortedBlocks.length - 1; i >= 0; i--) {
          const block = sortedBlocks[i];
          const fromIndex = BlockManager.blocks.indexOf(block);

          /**
           * When moving down, after removing a block from above,
           * the target effectively stays at the same position.
           * We want all blocks to end up at consecutive positions starting at effectiveTarget.
           */
          BlockManager.move(effectiveTarget + i, fromIndex);
        }
      }
    }

    this.onDragEnd();
  }

  /**
   * Clean up after drag ends (success or cancel)
   */
  private onDragEnd(): void {
    const draggedBlocks = this.draggedBlocks;

    /**
     * Remove dragging style from all blocks
     */
    draggedBlocks.forEach(block => {
      block.holder.classList.remove(this.CSS.blockDragging);
    });

    /**
     * Hide indicator
     */
    this.hideIndicator();

    /**
     * Clear state
     */
    this.draggedBlocks = [];
    this.dropTargetIndex = null;
    this.isDragging = false;

    /**
     * Reposition toolbar to the first dragged block's new location
     */
    if (draggedBlocks.length > 0) {
      this.Editor.Toolbar.moveAndOpen(draggedBlocks[0]);
    }
  }

  /**
   * Show the drop indicator
   */
  private showIndicator(): void {
    if (this.nodes.indicator) {
      this.nodes.indicator.classList.add(this.CSS.indicatorVisible);
    }
  }

  /**
   * Hide the drop indicator
   */
  private hideIndicator(): void {
    if (this.nodes.indicator) {
      this.nodes.indicator.classList.remove(this.CSS.indicatorVisible);
    }
  }

  /**
   * Position the indicator relative to a block
   *
   * @param blockHolder - the block element to position near
   * @param above - whether to show above (true) or below (false) the block
   */
  private positionIndicator(blockHolder: HTMLElement, above: boolean): void {
    if (!this.nodes.indicator) {
      return;
    }

    const wrapperRect = this.Editor.UI.nodes.wrapper.getBoundingClientRect();
    const blockRect = blockHolder.getBoundingClientRect();

    /**
     * Calculate Y position relative to wrapper
     */
    const yPosition = above
      ? blockRect.top - wrapperRect.top
      : blockRect.bottom - wrapperRect.top;

    this.nodes.indicator.style.top = `${yPosition}px`;
  }
}
