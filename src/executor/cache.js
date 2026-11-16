'use strict';

class ToolCache {
  constructor({ maxSize = 1000, ttlMs = 3600 * 1000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _key(name, args) {
    return `${name}\u0000${args}`;
  }

  get(name, args) {
    const key = this._key(name, args);
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.time > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(name, args, value) {
    const key = this._key(name, args);
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, { value, time: Date.now() });
  }

  wrap(name, fn) {
    const self = this;
    return async function (...args) {
      const argStr = args.length === 1 ? String(args[0]) : JSON.stringify(args);
      const cached = self.get(name, argStr);
      if (cached !== undefined) {
        return cached;
      }
      const result = await fn.apply(this, args);
      self.set(name, argStr, result);
      return result;
    };
  }
}

module.exports = { ToolCache };