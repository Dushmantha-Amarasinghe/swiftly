import localforage from "localforage";

// Structured data cache (chats, messages, profiles)
export const dataCache = localforage.createInstance({
  name: "swiftly",
  storeName: "data",
});

// Media cache (files: images, audio)
export const mediaCache = localforage.createInstance({
  name: "swiftly",
  storeName: "media",
});

// Save JSON (rooms, messages, profiles)
export async function saveData(key, value) {
  return dataCache.setItem(key, value);
}

export async function loadData(key) {
  return dataCache.getItem(key);
}

// Save media blob (image, audio)
export async function saveMedia(url, blob) {
  return mediaCache.setItem(url, blob);
}

export async function loadMedia(url) {
  return mediaCache.getItem(url); // returns Blob if exists
}