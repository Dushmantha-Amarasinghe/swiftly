import { getToken,deleteToken  } from "firebase/messaging";
import { messaging, db } from "./firebase";
import { doc, updateDoc } from "firebase/firestore";

export async function requestNotificationPermission(user) {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    // 👇 Delete old token first
    await deleteToken(messaging);

    const token = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
    });

    

    await updateDoc(doc(db, "profiles", user.uid), {
      fcmToken: token
    });
  } catch (err) {
    console.error("Error getting FCM token:", err);
  }
}