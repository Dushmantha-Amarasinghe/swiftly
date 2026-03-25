/* firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

async function loadConfig() {
  try {
    const res = await fetch("/firebase-sw-config.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Background push is enabled only when local runtime config is present.
loadConfig().then((config) => {
  if (!config) {
    console.warn("[Service Worker] Missing /firebase-sw-config.json. Background notifications disabled.");
    return;
  }

  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log("[Service Worker] Background push received:", payload);

    const data = payload.data || {};
    const title = data.title || data.senderName || data.roomTitle || "Swiftly";
    const body = data.body || "New message";
    const icon =
      data.senderPhoto && data.senderPhoto.startsWith("http")
        ? data.senderPhoto
        : "/logo-swiftly.svg";

    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/logo-swiftly.svg",
      data: { roomId: data.roomId },
    });
  });
});

// Handle click on notification
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // If app is already open → focus + tell it which chat
      if (list.length > 0) {
        const client = list[0];
        client.focus();
        client.postMessage({ type: "OPEN_ROOM", roomId });
        return;
      }
      // Else cold start → open root
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});