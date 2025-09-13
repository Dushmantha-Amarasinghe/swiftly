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

messaging.onBackgroundMessage((payload) => {
  console.log("[Service Worker] Background push received:", payload);

  const data = payload.data || {};

  // 👇 Use explicit fields sent from backend
  const title = data.title || data.senderName || data.roomTitle || "Swiftly";
  const body  = data.body  || "New message";
  const icon  = (data.senderPhoto && data.senderPhoto.startsWith("http"))
    ? data.senderPhoto
    : "/logo-swiftly.svg";

  const options = {
    body,
    icon,
    badge: "/logo-swiftly.svg",
    data: { roomId: data.roomId }
  };

  self.registration.showNotification(title, options);
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (roomId && client.url.includes("/rooms/" + roomId) && "focus" in client) {
          return client.focus();
        }
      }
      return roomId
        ? clients.openWindow("/rooms/" + roomId)
        : clients.openWindow("/");
    })
  );
});