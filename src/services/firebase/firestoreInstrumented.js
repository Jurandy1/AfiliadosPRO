export * from "@firebase/firestore-native";

import {
  addDoc as nativeAddDoc,
  average as nativeAverage,
  count as nativeCount,
  deleteDoc as nativeDeleteDoc,
  getAggregateFromServer as nativeGetAggregateFromServer,
  getDoc as nativeGetDoc,
  getDocs as nativeGetDocs,
  onSnapshot as nativeOnSnapshot,
  runTransaction as nativeRunTransaction,
  setDoc as nativeSetDoc,
  sum as nativeSum,
  updateDoc as nativeUpdateDoc,
  writeBatch as nativeWriteBatch,
} from "@firebase/firestore-native";

export const sum = nativeSum;
export const count = nativeCount;
export const average = nativeAverage;

import {
  captureSource,
  inferCollectionFromQuery,
  trackFirestoreRead,
  trackFirestoreWrite,
} from "./readTracker.js";

export async function getDocs(reference) {
  const source = captureSource();
  const t0 = performance.now();
  const snap = await nativeGetDocs(reference);
  const durationMs = Math.round(performance.now() - t0);
  trackFirestoreRead({
    op: "getDocs",
    collection: inferCollectionFromQuery(reference),
    docs: snap.size,
    source,
    durationMs,
  });
  return snap;
}

export async function getDoc(reference) {
  const source = captureSource();
  const t0 = performance.now();
  const snap = await nativeGetDoc(reference);
  const durationMs = Math.round(performance.now() - t0);
  trackFirestoreRead({
    op: "getDoc",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
    durationMs,
  });
  return snap;
}

export async function getAggregateFromServer(reference, aggregateSpec) {
  const source = captureSource();
  const t0 = performance.now();
  const snap = await nativeGetAggregateFromServer(reference, aggregateSpec);
  const durationMs = Math.round(performance.now() - t0);
  trackFirestoreRead({
    op: "aggregate",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
    durationMs,
  });
  return snap;
}

function wrapSnapshotCallback(ref, source, callback) {
  if (typeof callback !== "function") return callback;
  let isFirst = true;
  return (snapshot) => {
    const docs = snapshot?.size ?? (snapshot?.exists?.() ? 1 : 0);
    trackFirestoreRead({
      op: isFirst ? "onSnapshot:inicial" : "onSnapshot:update",
      collection: inferCollectionFromQuery(ref),
      docs: typeof docs === "number" ? docs : 1,
      source,
    });
    isFirst = false;
    return callback(snapshot);
  };
}

export function onSnapshot(...args) {
  const ref = args[0];
  const source = captureSource();
  const patched = [...args];

  if (typeof patched[1] === "function") {
    patched[1] = wrapSnapshotCallback(ref, source, patched[1]);
  } else if (typeof patched[1] === "object" && typeof patched[2] === "function") {
    patched[2] = wrapSnapshotCallback(ref, source, patched[2]);
  } else if (typeof patched[2] === "function") {
    patched[2] = wrapSnapshotCallback(ref, source, patched[2]);
  }

  return nativeOnSnapshot(...patched);
}

export async function setDoc(reference, data, options) {
  const source = captureSource();
  const result = await nativeSetDoc(reference, data, options);
  trackFirestoreWrite({
    op: "setDoc",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
  });
  return result;
}

export async function updateDoc(reference, data, ...rest) {
  const source = captureSource();
  const result = await nativeUpdateDoc(reference, data, ...rest);
  trackFirestoreWrite({
    op: "updateDoc",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
  });
  return result;
}

export async function deleteDoc(reference) {
  const source = captureSource();
  const result = await nativeDeleteDoc(reference);
  trackFirestoreWrite({
    op: "deleteDoc",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
  });
  return result;
}

export async function addDoc(reference, data) {
  const source = captureSource();
  const result = await nativeAddDoc(reference, data);
  trackFirestoreWrite({
    op: "addDoc",
    collection: inferCollectionFromQuery(reference),
    docs: 1,
    source,
  });
  return result;
}

export function writeBatch(firestore) {
  const batch = nativeWriteBatch(firestore);
  const pending = [];

  const trackOp = (op, ref) => {
    pending.push({
      op,
      collection: inferCollectionFromQuery(ref),
    });
  };

  return {
    set(ref, data, options) {
      trackOp("batch:set", ref);
      return batch.set(ref, data, options);
    },
    update(ref, data, ...rest) {
      trackOp("batch:update", ref);
      return batch.update(ref, data, ...rest);
    },
    delete(ref) {
      trackOp("batch:delete", ref);
      return batch.delete(ref);
    },
    commit() {
      const source = captureSource();
      for (const item of pending) {
        trackFirestoreWrite({
          op: item.op,
          collection: item.collection,
          docs: 1,
          source,
        });
      }
      pending.length = 0;
      return batch.commit();
    },
  };
}

export async function runTransaction(firestore, updateFunction, options) {
  const source = captureSource();
  let txReads = 0;
  let txWrites = 0;

  const result = await nativeRunTransaction(firestore, async (transaction) => {
    const wrapped = {
      get(ref) {
        txReads += 1;
        return transaction.get(ref);
      },
      set(ref, data, opts) {
        txWrites += 1;
        return transaction.set(ref, data, opts);
      },
      update(ref, data, ...rest) {
        txWrites += 1;
        return transaction.update(ref, data, ...rest);
      },
      delete(ref) {
        txWrites += 1;
        return transaction.delete(ref);
      },
    };
    return updateFunction(wrapped);
  }, options);

  if (txReads > 0) {
    trackFirestoreRead({
      op: "runTransaction",
      collection: "transacao",
      docs: txReads,
      source,
    });
  }
  if (txWrites > 0) {
    trackFirestoreWrite({
      op: "runTransaction",
      collection: "transacao",
      docs: txWrites,
      source,
    });
  }

  return result;
}
