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
      dragImageContainer: 'ce-drag-image-container',
      blockContent: 'ce-block__content',
      blockStretched: 'ce-block--stretched',
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
   * Container element for the custom drag image
   * Created on dragstart, removed on dragend
   */
  private dragImageContainer: HTMLElement | null = null;

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
        const toolbarRetryDelayMs = 100;

        setTimeout(trySetup, toolbarRetryDelayMs);

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

    this.readOnlyMutableListeners.on(settingsButton, 'dragstart', (event) => {
      this.onDragStart(event as DragEvent);
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

    this.readOnlyMutableListeners.on(holder, 'dragover', (event) => {
      this.onDragOver(event as DragEvent);
    });

    this.readOnlyMutableListeners.on(holder, 'drop', (event) => {
      this.onDrop(event as DragEvent);
    });

    this.readOnlyMutableListeners.on(holder, 'dragleave', (event) => {
      this.onDragLeave(event as DragEvent);
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
    const hoveredBlock = (Toolbar as unknown as { hoveredBlock: Block | undefined }).hoveredBlock;

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
      this.draggedBlocks = [ hoveredBlock ];
    }

    /**
     * Set data transfer to identify this as a block drag
     */
    if (event.dataTransfer) {
      event.dataTransfer.setData('editor/block-drag', this.draggedBlocks.map(b => b.id).join(','));
      /* eslint-disable-next-line no-param-reassign -- DataTransfer API requires setting this property */
      event.dataTransfer.effectAllowed = 'move';
    }

    /**
     * Apply dragging style to all dragged blocks
     */
    this.draggedBlocks.forEach(block => {
      block.holder.classList.add(this.CSS.blockDragging);
    });

    /**
     * Create custom drag image showing all dragged blocks
     */
    this.createDragImage(event);

    /**
     * Show indicator
     */
    this.showIndicator();
  }

  /**
   * Create a custom drag image that shows all selected blocks
   * The container is positioned to include both the handle and blocks,
   * ensuring the cursor falls within the drag image bounds.
   *
   * @param event - dragstart event
   */
  private createDragImage(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }

    const settingsButton = this.Editor.Toolbar.nodes.settingsToggler;

    if (!settingsButton) {
      return;
    }

    const blocks = this.draggedBlocks;

    if (blocks.length === 0) {
      return;
    }

    /**
     * Check if any block is stretched (full-width)
     * If so, we need different container bounds and styling
     */
    const hasStretchedBlock = blocks.some(block =>
      block.holder.classList.contains(this.CSS.blockStretched)
    );

    /**
     * Get handle position
     */
    const handleRect = settingsButton.getBoundingClientRect();

    /**
     * Calculate bounding box of all selected blocks
     * Use the content element, not the holder (holder is full-width)
     */
    const blockContentSelector = `.${this.CSS.blockContent}`;
    const firstBlockContent = blocks[0].holder.querySelector(blockContentSelector) as HTMLElement;
    const lastBlockContent = blocks[blocks.length - 1].holder.querySelector(blockContentSelector) as HTMLElement;

    const firstBlockRect = (firstBlockContent || blocks[0].holder).getBoundingClientRect();
    const lastBlockRect = (lastBlockContent || blocks[blocks.length - 1].holder).getBoundingClientRect();

    const blocksLeft = firstBlockRect.left;
    const blocksTop = firstBlockRect.top;
    const blocksRight = firstBlockRect.right;
    const blocksBottom = lastBlockRect.bottom;

    /**
     * Create container inside .codex-editor for CSS inheritance
     */
    const container = $.make('div', this.CSS.dragImageContainer);

    /**
     * Calculate container bounds
     * For stretched blocks: use holder bounds (full editor width)
     * For normal blocks: span from handle to blocks
     */
    const holderRect = blocks[0].holder.getBoundingClientRect();
    const containerLeft = hasStretchedBlock ? holderRect.left : Math.min(handleRect.left, blocksLeft);
    const containerRight = hasStretchedBlock ? holderRect.right : Math.max(handleRect.right, blocksRight);
    const containerTop = Math.min(handleRect.top, blocksTop);
    const containerBottom = Math.max(handleRect.bottom, blocksBottom);
    const containerWidth = containerRight - containerLeft;
    const containerHeight = containerBottom - containerTop;

    /**
     * For stretched blocks, don't add background
     */
    const backgroundStyle = hasStretchedBlock ? '' : 'background: rgba(255, 255, 255, 0.01);';

    container.style.cssText = `
      position: fixed;
      left: ${containerLeft}px;
      top: ${containerTop}px;
      width: ${containerWidth}px;
      height: ${containerHeight}px;
      pointer-events: none;
      ${backgroundStyle}
    `;

    /**
     * Clone each selected block's content into the container
     */
    blocks.forEach(block => {
      const blockContent = block.holder.querySelector(blockContentSelector) as HTMLElement;
      const isStretched = block.holder.classList.contains(this.CSS.blockStretched);

      /**
       * For stretched blocks, use holder for dimensions (content may not be full width)
       * For normal blocks, use content element
       */
      const elementToClone = blockContent || block.holder;
      const positioningRect = isStretched ? block.holder.getBoundingClientRect() : elementToClone.getBoundingClientRect();
      const clone = elementToClone.cloneNode(true) as HTMLElement;

      /**
       * Position clone absolutely within container at exact viewport position
       */
      const cloneLeft = positioningRect.left - containerLeft;
      const cloneTop = positioningRect.top - containerTop;
      const cloneWidth = positioningRect.width;

      clone.style.position = 'absolute';
      clone.style.left = `${cloneLeft}px`;
      clone.style.top = `${cloneTop}px`;
      clone.style.width = `${cloneWidth}px`;
      clone.style.maxWidth = isStretched ? 'none' : '';
      clone.style.margin = '0';
      clone.style.animation = 'none';
      clone.style.transition = 'none';
      clone.style.opacity = '1';
      clone.style.transform = 'none';

      /**
       * For images, replace cloned img with a canvas containing the already-loaded original
       * This avoids the issue where cloned images need to re-decode
       */
      const originalImages = elementToClone.querySelectorAll('img');
      const clonedImages = clone.querySelectorAll('img');

      originalImages.forEach((origImg, idx) => {
        const clonedImg = clonedImages[idx] as HTMLImageElement | undefined;

        if (!clonedImg || !origImg.complete || origImg.naturalWidth === 0) {
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          return;
        }

        const origRect = origImg.getBoundingClientRect();

        canvas.width = origRect.width;
        canvas.height = origRect.height;
        canvas.style.width = `${origRect.width}px`;
        canvas.style.height = `${origRect.height}px`;

        ctx.drawImage(origImg, 0, 0, origRect.width, origRect.height);

        clonedImg.replaceWith(canvas);
      });

      container.appendChild(clone);
    });

    /**
     * Append to editor wrapper for CSS inheritance
     */
    this.Editor.UI.nodes.wrapper.appendChild(container);

    /**
     * Force a reflow so the browser renders the container before we capture it
     */
    void container.offsetHeight;

    /**
     * Get actual rendered position (may differ from set values due to transforms etc)
     */
    const actualRect = container.getBoundingClientRect();

    /**
     * Calculate offset - where cursor is relative to container's ACTUAL top-left
     */
    const offsetX = event.clientX - actualRect.left;
    const offsetY = event.clientY - actualRect.top;

    /**
     * Set the drag image
     */
    event.dataTransfer.setDragImage(container, offsetX, offsetY);

    /**
     * Move container off-screen after browser captures it for the drag image
     * We can't hide it (browser needs it visible), but we can position it off-screen
     */
    container.style.left = '-9999px';

    /**
     * Store reference for cleanup on dragend
     */
    this.dragImageContainer = container;
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
      /* eslint-disable-next-line no-param-reassign -- DataTransfer API requires setting this property */
      event.dataTransfer.dropEffect = 'move';
    }

    const { BlockManager } = this.Editor;
    const blocks = BlockManager.blocks;

    if (blocks.length === 0) {
      return;
    }

    const cursorY = event.clientY;
    const dropTarget = this.findDropTarget(blocks, cursorY);

    /**
     * Calculate drop index
     * - Top half: insert before target block
     * - Bottom half: insert after target block
     */
    this.dropTargetIndex = dropTarget.isTopHalf ? dropTarget.index : dropTarget.index + 1;

    /**
     * Position the indicator
     */
    this.positionIndicator(dropTarget.block.holder, dropTarget.isTopHalf);
  }

  /**
   * Find the target block for dropping based on cursor position
   *
   * @param blocks - array of blocks
   * @param cursorY - vertical cursor position
   * @returns target block info
   */
  private findDropTarget(blocks: Block[], cursorY: number): { block: Block; index: number; isTopHalf: boolean } {
    /**
     * Check if cursor is above all blocks
     */
    const firstRect = blocks[0].holder.getBoundingClientRect();

    if (cursorY < firstRect.top) {
      return {
        block: blocks[0],
        index: 0,
        isTopHalf: true,
      };
    }

    /**
     * Check if cursor is below all blocks
     */
    const lastBlock = blocks[blocks.length - 1];
    const lastRect = lastBlock.holder.getBoundingClientRect();

    if (cursorY >= lastRect.bottom) {
      return {
        block: lastBlock,
        index: blocks.length - 1,
        isTopHalf: false,
      };
    }

    /**
     * Find the block containing the cursor
     */
    const targetIndex = blocks.findIndex(block => {
      const rect = block.holder.getBoundingClientRect();

      return cursorY >= rect.top && cursorY < rect.bottom;
    });

    const index = targetIndex >= 0 ? targetIndex : 0;
    const targetBlock = blocks[index];
    const rect = targetBlock.holder.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    return {
      block: targetBlock,
      index,
      isTopHalf: cursorY < midpoint,
    };
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
    const sortedBlocks = [ ...this.draggedBlocks ].sort((a, b) => {
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

    if (isMovingUp) {
      this.moveBlocksUp(sortedBlocks, effectiveTarget, BlockManager);
    }

    if (isMovingDown) {
      this.moveBlocksDown(sortedBlocks, effectiveTarget, BlockManager);
    }

    this.onDragEnd();
  }

  /**
   * Move blocks upward in the editor
   * Process from top to bottom (first block in selection first)
   *
   * @param sortedBlocks - blocks sorted by position
   * @param effectiveTarget - target index after accounting for removed blocks
   * @param BlockManager - block manager module
   */
  private moveBlocksUp(sortedBlocks: Block[], effectiveTarget: number, BlockManager: { blocks: Block[]; move: (toIndex: number, fromIndex: number) => void }): void {
    sortedBlocks.forEach((block, i) => {
      const fromIndex = BlockManager.blocks.indexOf(block);

      BlockManager.move(effectiveTarget + i, fromIndex);
    });
  }

  /**
   * Move blocks downward in the editor
   * Process from bottom to top (last block in selection first)
   *
   * @param sortedBlocks - blocks sorted by position
   * @param effectiveTarget - target index after accounting for removed blocks
   * @param BlockManager - block manager module
   */
  private moveBlocksDown(sortedBlocks: Block[], effectiveTarget: number, BlockManager: { blocks: Block[]; move: (toIndex: number, fromIndex: number) => void }): void {
    [ ...sortedBlocks ].reverse().forEach((block, reverseIndex) => {
      const fromIndex = BlockManager.blocks.indexOf(block);
      const i = sortedBlocks.length - 1 - reverseIndex;

      BlockManager.move(effectiveTarget + i, fromIndex);
    });
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
     * Remove drag image container
     */
    if (this.dragImageContainer) {
      this.dragImageContainer.remove();
      this.dragImageContainer = null;
    }

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

    /**
     * Ensure indicator is visible (may have been hidden if cursor left window)
     */
    this.showIndicator();
  }
}
