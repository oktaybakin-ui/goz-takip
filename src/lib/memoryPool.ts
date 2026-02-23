/**
 * Memory pool for efficient array management
 */
export class MemoryPool<T> {
  private pool: T[][] = [];
  private maxSize: number;
  
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }
  
  acquire(size: number): T[] {
    // Try to get from pool
    const index = this.pool.findIndex(arr => arr.length >= size);
    if (index !== -1) {
      const arr = this.pool.splice(index, 1)[0];
      arr.length = size;
      return arr;
    }
    
    // Create new if not available
    return new Array(size);
  }
  
  release(arr: T[]): void {
    if (this.pool.length < this.maxSize && arr.length > 0) {
      // Clear array but keep capacity
      arr.length = 0;
      this.pool.push(arr);
    }
  }
  
  clear(): void {
    this.pool = [];
  }
}

// Singleton pools
export const pointPool = new MemoryPool<{x: number; y: number}>();
export const numberPool = new MemoryPool<number>();