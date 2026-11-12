"use client";

import type { NewSubmission, Room, Submission } from "../types";
import type { ClassroomService } from "./types";

const DB_NAME = "chuncheon-maker";
const DB_VERSION = 1;
const ROOMS = "rooms";
const SUBMISSIONS = "submissions";
const CHANNEL = "chuncheon-maker-sync";

type SyncMessage = { type: "submissions-changed"; roomCode: string } | { type: "rooms-changed" };

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** IndexedDB + BroadcastChannel 기반 구현. 같은 브라우저의 여러 탭 사이에서 실시간 동기화됩니다. */
export class LocalClassroomService implements ClassroomService {
  readonly strictRoomCheck = false;

  private dbPromise: Promise<IDBDatabase> | null = null;
  private channel: BroadcastChannel | null = null;
  private localListeners = new Set<(msg: SyncMessage) => void>();

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(ROOMS)) {
            db.createObjectStore(ROOMS, { keyPath: "code" });
          }
          if (!db.objectStoreNames.contains(SUBMISSIONS)) {
            const s = db.createObjectStore(SUBMISSIONS, { keyPath: "id" });
            s.createIndex("roomCode", "roomCode", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private getChannel(): BroadcastChannel | null {
    if (this.channel || typeof BroadcastChannel === "undefined") return this.channel;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      this.localListeners.forEach((l) => l(e.data));
    };
    return this.channel;
  }

  private notify(msg: SyncMessage) {
    // 다른 탭으로 전파 + 같은 탭의 구독자에게도 전달
    this.getChannel()?.postMessage(msg);
    this.localListeners.forEach((l) => l(msg));
  }

  async createRoom({ school, className }: { school: string; className: string }): Promise<Room> {
    const db = await this.db();
    const existing = new Set((await this.listRooms()).map((r) => r.code));
    let code = "";
    for (let i = 0; i < 200; i++) {
      const c = String(Math.floor(1000 + Math.random() * 9000));
      if (!existing.has(c)) {
        code = c;
        break;
      }
    }
    if (!code) throw new Error("사용 가능한 수업 코드가 없어요.");
    const room: Room = { code, school, className, createdAt: Date.now() };
    const tx = db.transaction(ROOMS, "readwrite");
    tx.objectStore(ROOMS).put(room);
    await txDone(tx);
    this.notify({ type: "rooms-changed" });
    return room;
  }

  async getRoom(code: string): Promise<Room | null> {
    const db = await this.db();
    const r = await promisify(db.transaction(ROOMS).objectStore(ROOMS).get(code));
    return (r as Room | undefined) ?? null;
  }

  async listRooms(): Promise<Room[]> {
    const db = await this.db();
    const all = (await promisify(db.transaction(ROOMS).objectStore(ROOMS).getAll())) as Room[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async addSubmission(input: NewSubmission): Promise<Submission> {
    const db = await this.db();
    const sub: Submission = { ...input, id: uid(), createdAt: Date.now() };
    const tx = db.transaction(SUBMISSIONS, "readwrite");
    tx.objectStore(SUBMISSIONS).put(sub);
    await txDone(tx);
    this.notify({ type: "submissions-changed", roomCode: sub.roomCode });
    return sub;
  }

  async getSubmission(id: string): Promise<Submission | null> {
    const db = await this.db();
    const r = await promisify(db.transaction(SUBMISSIONS).objectStore(SUBMISSIONS).get(id));
    return (r as Submission | undefined) ?? null;
  }

  async listSubmissions(roomCode: string): Promise<Submission[]> {
    const db = await this.db();
    const idx = db.transaction(SUBMISSIONS).objectStore(SUBMISSIONS).index("roomCode");
    const all = (await promisify(idx.getAll(roomCode))) as Submission[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteSubmission(id: string): Promise<void> {
    const existing = await this.getSubmission(id);
    const db = await this.db();
    const tx = db.transaction(SUBMISSIONS, "readwrite");
    tx.objectStore(SUBMISSIONS).delete(id);
    await txDone(tx);
    if (existing) this.notify({ type: "submissions-changed", roomCode: existing.roomCode });
  }

  subscribeSubmissions(roomCode: string, cb: (items: Submission[]) => void): () => void {
    let alive = true;
    const refresh = () => {
      this.listSubmissions(roomCode).then((items) => alive && cb(items));
    };
    const listener = (msg: SyncMessage) => {
      if (msg.type === "submissions-changed" && msg.roomCode === roomCode) refresh();
    };
    this.getChannel();
    this.localListeners.add(listener);
    // 탭이 다시 보일 때도 한 번 새로고침 (BroadcastChannel 미지원 브라우저 대비)
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    refresh();
    return () => {
      alive = false;
      this.localListeners.delete(listener);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
}
