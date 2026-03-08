interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const inMemoryStorageMap = new Map<string, string>();

const inMemoryStorage: Storage = {
  get length() {
    return inMemoryStorageMap.size;
  },
  clear() {
    inMemoryStorageMap.clear();
  },
  getItem(key: string) {
    return inMemoryStorageMap.get(key) ?? null;
  },
  key(index: number) {
    let cursor = 0;
    for (const key of inMemoryStorageMap.keys()) {
      if (cursor === index) {
        return key;
      }
      cursor += 1;
    }
    return null;
  },
  removeItem(key: string) {
    inMemoryStorageMap.delete(key);
  },
  setItem(key: string, value: string) {
    inMemoryStorageMap.set(key, value);
  },
};

function isStorageLike(value: unknown): value is StorageLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "getItem" in value &&
    typeof value.getItem === "function" &&
    "setItem" in value &&
    typeof value.setItem === "function" &&
    "removeItem" in value &&
    typeof value.removeItem === "function"
  );
}

export function getPersistentStorage(): Storage {
  const maybeStorage =
    typeof globalThis === "object" && "localStorage" in globalThis
      ? (globalThis as { localStorage?: unknown }).localStorage
      : undefined;

  if (isStorageLike(maybeStorage)) {
    return maybeStorage as Storage;
  }

  return inMemoryStorage;
}
