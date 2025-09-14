/* firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB2wfxDBNWVdP5yknK6M6jGtVmb3l8Bcxs",
  authDomain: "swiftly-70a5b.firebaseapp.com",
  databaseURL: "https://swiftly-70a5b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "swiftly-70a5b",
  storageBucket: "swiftly-70a5b.firebasestorage.app",
  messagingSenderId: "251177712115",
  appId: "1:251177712115:web:52429a7d0b5ba96ef17a86"
});

const messaging = firebase.messaging();

// Background push → build custom notification
messaging.onBackgroundMessage((payload) => {
  console.log("[Service Worker] Background push received:", payload);

  const data = payload.data || {};

  const title = data.title || data.senderName || data.roomTitle || "Swiftly";
  const body  = data.body  || "New message";
  const icon  = (data.senderPhoto && data.senderPhoto.startsWith("http"))
    ? data.senderPhoto
    : "/logo-swiftly.svg";

  self.registration.showNotification(title, {
    body,
    icon,
    badge: "/logo-swiftly.svg",
    data: { roomId: data.roomId }
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