import { parseProject, type Project } from "@sketch/core";
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("sketch-to-play", 1);
    request.onupgradeneeded = () => {
      for (const name of ["documents", "snapshots", "meta"])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function load(): Promise<Project | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(["documents", "meta", "snapshots"], "readonly");
    const r = tx.objectStore("meta").get("active");
    r.onsuccess = () => {
      if (!r.result) {
        resolve(undefined);
        return;
      }
      const doc = tx.objectStore("documents").get(r.result);
      doc.onsuccess = () => {
        try {
          resolve(parseProject(doc.result));
        } catch {
          const snapshots = tx.objectStore("snapshots").get(r.result);
          snapshots.onsuccess = () => {
            for (const candidate of (snapshots.result ?? []).reverse()) {
              try {
                resolve(parseProject(candidate));
                return;
              } catch {
                /* Try previous valid snapshot. */
              }
            }
            reject(Error("存档损坏，未找到有效恢复副本"));
          };
        }
      };
    };
    tx.onerror = () => reject(tx.error);
  });
}
let queue = Promise.resolve();
const known = new Map<string, number>();
export function markLoaded(p: Project) {
  known.set(p.scene.sceneId, p.scene.revision);
}
export function save(p: Project): Promise<void> {
  const work = async () => {
    const d = await db();
    return new Promise<void>((resolve, reject) => {
      const tx = d.transaction(["documents", "snapshots", "meta"], "readwrite");
      const docs = tx.objectStore("documents"),
        r = docs.get(p.scene.sceneId);
      let conflict = false;
      r.onsuccess = () => {
        const stored = r.result as Project | undefined,
          expected = known.get(p.scene.sceneId);
        if (stored && stored.scene.revision !== expected) {
          conflict = true;
          tx.abort();
          return;
        }
        docs.put(p, p.scene.sceneId);
        tx.objectStore("meta").put(p.scene.sceneId, "active");
        const snaps = tx.objectStore("snapshots"),
          sr = snaps.get(p.scene.sceneId);
        sr.onsuccess = () =>
          snaps.put([...(sr.result ?? []), p].slice(-5), p.scene.sceneId);
      };
      tx.oncomplete = () => {
        known.set(p.scene.sceneId, p.scene.revision);
        resolve();
      };
      tx.onabort = () =>
        reject(
          Error(
            conflict
              ? "其他标签页已更新此场景，请导出备份后刷新"
              : "本地保存失败，请导出备份",
          ),
        );
      tx.onerror = () => reject(tx.error);
    });
  };
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}
