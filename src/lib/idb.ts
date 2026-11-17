// Tiny IndexedDB wrapper. Everything stays in this browser profile.
const DB_NAME = 'session-browser';
// roots: picked folders · summaries: per-file parse cache · snapshot: last sync's session list
// messages: recently opened conversations, so they open before the next sync
// devices: totals imported from this person's other computers
const STORES = ['roots', 'summaries', 'snapshot', 'messages', 'devices'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	return (dbp ??= new Promise((resolve, reject) => {
		const r = indexedDB.open(DB_NAME, 3);
		r.onupgradeneeded = () => STORES.forEach((s) => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s));
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	}));
}

function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const t = db.transaction(store, mode);
				const req = fn(t.objectStore(store));
				t.oncomplete = () => resolve(req ? req.result : (undefined as T));
				t.onerror = () => reject(t.error);
				t.onabort = () => reject(t.error);
			})
	);
}

export const idb = {
	get: <T>(store: Store, key: string) => tx<T>(store, 'readonly', (s) => s.get(key)).catch(() => undefined),
	set: (store: Store, key: string, value: unknown) => tx(store, 'readwrite', (s) => void s.put(value, key)).catch(() => undefined),
	del: (store: Store, key: string) => tx(store, 'readwrite', (s) => void s.delete(key)).catch(() => undefined),
	all: <T>(store: Store) => tx<T[]>(store, 'readonly', (s) => s.getAll()).catch(() => [] as T[]),
	keys: (store: Store) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]),
	clear: (store: Store) => tx(store, 'readwrite', (s) => void s.clear()).catch(() => undefined)
};
