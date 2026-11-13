/* Chrome Web Store build only. The background queue serializes writes and resets. */
(() => {
  'use strict';
  const area = chrome.storage.local;
  const dataKey = 'sealedData';
  const keyDatabase = 'curb-local-keys';
  const keyStore = 'keys';
  const keyId = 'storage';
  const format = 1;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const additionalData = encoder.encode('Curb local data v1');
  let access;

  function trustedStorage() {
    access ??= area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(error => {
      access = undefined;
      throw error;
    });
    return access;
  }

  async function keyTransaction(mode, action) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(keyDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(keyStore);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(keyStore, mode);
        const request = action(transaction.objectStore(keyStore));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error || new Error('Local key storage operation failed.'));
      });
    } finally { db.close(); }
  }

  const toBase64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const fromBase64 = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
  const algorithm = iv => ({ name: 'AES-GCM', iv, additionalData });

  async function read() {
    await trustedStorage();
    const stored = await area.get(dataKey);
    if (!Object.hasOwn(stored, dataKey)) return { data: {}, key: null };
    try {
      const record = stored[dataKey];
      if (record?.version !== format || typeof record.iv !== 'string' || typeof record.ciphertext !== 'string')
        throw new Error('Invalid local data format.');
      const iv = fromBase64(record.iv);
      if (iv.length !== 12) throw new Error('Invalid local data IV.');
      const key = await keyTransaction('readonly', store => store.get(keyId));
      if (!key) throw new Error('Local encryption key is missing.');
      const bytes = await crypto.subtle.decrypt(algorithm(iv), key, fromBase64(record.ciphertext));
      const data = JSON.parse(decoder.decode(bytes));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid local data.');
      return { data, key };
    } catch (cause) {
      throw new Error('Local data could not be read. Clear local data in Settings to start over.', { cause });
    }
  }

  globalThis.CurbStore = Object.freeze({
    async get(keys) {
      const { data } = await read();
      if (keys == null) return data;
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
    },
    async set(values) {
      let { data, key } = await read();
      if (!key) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await keyTransaction('readwrite', store => store.put(key, keyId));
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt(algorithm(iv), key, encoder.encode(JSON.stringify({ ...data, ...values })));
      await area.set({ [dataKey]: { version: format, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(bytes)) } });
    },
    async clear() {
      await trustedStorage();
      await area.clear();
      await keyTransaction('readwrite', store => store.delete(keyId));
    }
  });
})();
