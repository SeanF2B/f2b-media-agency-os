export type PendingChessMove = {
  gameId: string;
  from: string;
  to: string;
  promotion: string;
  beforeFen: string;
  afterFen: string;
  san: string;
  color: "w" | "b";
  by: string;
  at: string;
};

type ChessSnapshot<Game> = { games: Game[]; pendingMoves: PendingChessMove[]; savedAt: number };
const databaseName = "f2b-chess-offline";
const storeName = "snapshots";
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the local chess store."));
    request.onblocked = () => reject(new Error("The local chess store is blocked by another tab."));
  });
  return databasePromise;
}

export async function loadChessSnapshot<Game>(userId: string): Promise<ChessSnapshot<Game> | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(userId);
    request.onsuccess = () => resolve(request.result ? { games: request.result.games || [], pendingMoves: request.result.pendingMoves || [], savedAt: request.result.savedAt || 0 } : null);
    request.onerror = () => reject(request.error || new Error("Could not read the local chess store."));
  });
}

export async function saveChessSnapshot<Game>(userId: string, snapshot: ChessSnapshot<Game>): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({ key: userId, ...snapshot });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save the local chess store."));
    transaction.onabort = () => reject(transaction.error || new Error("The local chess save was interrupted."));
  });
}
