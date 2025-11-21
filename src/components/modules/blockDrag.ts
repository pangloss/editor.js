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
   * The block currently being dragged
   */
  private draggedBlock: Block | null = null;

  /**
   * Index where the block would be dropped
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
    const { Toolbar } = this.Editor;

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

    this.draggedBlock = hoveredBlock;

    /**
     * Set data transfer to identify this as a block drag
     */
    if (event.dataTransfer) {
      event.dataTransfer.setData('editor/block-drag', hoveredBlock.id);
      event.dataTransfer.effectAllowed = 'move';
    }

    /**
     * Apply dragging style to the block
     */
    hoveredBlock.holder.classList.add(this.CSS.blockDragging);

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
    if (!this.draggedBlock) {
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
    if (!this.draggedBlock || this.dropTargetIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { BlockManager } = this.Editor;
    const fromIndex = BlockManager.blocks.indexOf(this.draggedBlock);

    /**
     * Adjust target index if moving down (since source will be removed first)
     */
    let toIndex = this.dropTargetIndex;

    if (fromIndex < toIndex) {
      toIndex--;
    }

    /**
     * Only move if position actually changed
     */
    if (fromIndex !== toIndex) {
      BlockManager.move(toIndex, fromIndex);
    }

    this.onDragEnd();
  }

  /**
   * Clean up after drag ends (success or cancel)
   */
  private onDragEnd(): void {
    /**
     * Remove dragging style
     */
    if (this.draggedBlock) {
      this.draggedBlock.holder.classList.remove(this.CSS.blockDragging);
    }

    /**
     * Hide indicator
     */
    this.hideIndicator();

    /**
     * Clear state
     */
    this.draggedBlock = null;
    this.dropTargetIndex = null;
    this.isDragging = false;
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
