class Store {
  private store = new Map<string, any>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  set<T> (key: string, value: T, ttl?: number): void {
    // 覆盖同 key 时必须取消旧 TTL 定时器，否则先到的旧定时器会提前删除新值
    const existingTimer = this.timers.get(key);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }
    this.store.set(key, value);
    if (ttl) {
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);
      // 不阻碍进程退出
      timer.unref?.();
      this.timers.set(key, timer);
    }
  }

  get<T> (key: string): T | null {
    return this.store.get(key) ?? null;
  }

  exists (...keys: string[]): number {
    return keys.filter(key => this.store.has(key)).length;
  }
}

const store = new Store();

export default store;
