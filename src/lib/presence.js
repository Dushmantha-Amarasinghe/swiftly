// presence.js
import { rtdb } from "./firebase";
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp,
  off,
  remove,
} from "firebase/database";

// Helper: write presence state + lastActive
function writeStatus(uid, state) {
  const statusRef = ref(rtdb, `presence/${uid}`);
  return set(statusRef, {
    state,
    lastActive: serverTimestamp(),
  });
}

export function setupPresence(uid) {
  const statusRef = ref(rtdb, `presence/${uid}`);
  const connectedRef = ref(rtdb, ".info/connected");

  // Track RTDB socket
  onValue(connectedRef, (snap) => {
    if (!snap.val()) return;

    // When connection fully drops, server writes offline automatically
    onDisconnect(statusRef).set({
      state: "offline",
      lastActive: serverTimestamp(),
    });

    // Mark online immediately when connected
    writeStatus(uid, "online");
  });

  // Visibility + focus/blur → online/away
  const handleVis = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      writeStatus(uid, "online");
    } else {
      writeStatus(uid, "away");
    }
  };
  window.addEventListener("focus", handleVis);
  window.addEventListener("blur", handleVis);
  document.addEventListener("visibilitychange", handleVis);

  // Network status
  const goOnline = () => writeStatus(uid, "online");
  const goOffline = () => writeStatus(uid, "offline");
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);

  // Heartbeat: refresh lastActive every 60s,
  // but ONLY when user is online + app is visible
  const hb = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      navigator.onLine
    ) {
      writeStatus(uid, "online");
    }
  }, 60_000);

  // Cleanup
  return () => {
    window.removeEventListener("focus", handleVis);
    window.removeEventListener("blur", handleVis);
    document.removeEventListener("visibilitychange", handleVis);
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
    clearInterval(hb);
  };
}

// Manual override (optional)
export function updatePresence(uid, state) {
  return writeStatus(uid, state);
}

// Subscribe to someone’s presence
export function subscribePresence(uids, onUpdate) {
  const unsubs = uids.map((uid) => {
    const r = ref(rtdb, `presence/${uid}`);
    return onValue(r, (snap) => {
      onUpdate(uid, snap.val() || { state: "offline" });
    });
  });
  return () => unsubs.forEach((u) => u());
}

export function goOfflineNow(uid) {
  // Force offline immediately
  return writeStatus(uid, "offline");
}


// USER starts typing in this room
export function startTyping(roomId, uid) {
  const typingRef = ref(rtdb, `typing/${roomId}/${uid}`);

  // Set typing true
  set(typingRef, {
    typing: true,
    updatedAt: serverTimestamp(),
  });

  // Ensure node is cleared if the connection closes unexpectedly
  onDisconnect(typingRef).remove();
}

// USER stops typing (manually called after 3s idle or message sent)
export function stopTyping(roomId, uid) {
  const typingRef = ref(rtdb, `typing/${roomId}/${uid}`);
  remove(typingRef); // this clears it when typing stops normally
}

// Subscribe to typing states for a room
export function subscribeTyping(roomId, onUpdate) {
  const roomRef = ref(rtdb, `typing/${roomId}`);
  return onValue(roomRef, (snap) => {
    const data = snap.val();
    onUpdate(snap.val() || {});
  });
}
