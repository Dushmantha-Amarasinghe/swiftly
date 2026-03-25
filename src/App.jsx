import { useEffect, useState, useRef } from "react";
import { auth, db, makeGoogleProvider, messaging } from "./lib/firebase";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  setupPresence,
  updatePresence,
  goOfflineNow,
  stopTyping,
} from "./lib/presence";

import SignIn from "./components/SignIn";
import ProfileSetup from "./components/ProfileSetup";
import ChatShell from "./components/ChatShell";

import { requestNotificationPermission } from "./lib/notifications";
import { onMessage } from "firebase/messaging";

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // New: track which room to auto-open from SW
  const [pendingRoomId, setPendingRoomId] = useState(null);
  const presenceCleanupRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(db, "profiles", u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const dn = u.displayName || "";
          const [firstName, ...rest] = dn.split(" ");
          const lastName = rest.join(" ");
          await setDoc(
            ref,
            {
              uid: u.uid,
              email: u.email || null,
              displayName: dn || null,
              firstName: firstName || "",
              lastName: lastName || "",
              photoURL: u.photoURL || null,
              setupComplete: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              privacy: { showOnline: true, showReadReceipts: true },
            },
            { merge: true }
          );
          const fresh = await getDoc(ref);
          setProfile(fresh.data());
        } else {
          setProfile(snap.data());
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;

    // 🔹 Start presence and SAVE cleanup
    const presenceCleanup = setupPresence(user.uid);

    // Mark online immediately
    updatePresence(user.uid, "online");

    // Event handlers for presence states
    const toOnline = () => updatePresence(user.uid, "online");
    const toAway = () => updatePresence(user.uid, "away");
    const toOffline = () => updatePresence(user.uid, "offline");

    const onVis = () =>
      updatePresence(
        user.uid,
        document.visibilityState === "visible" ? "online" : "away"
      );

    // Add listeners
    window.addEventListener("focus", toOnline);
    window.addEventListener("blur", toAway);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", toOffline);

    const onOnline = () => toOnline();
    const onOffline = () => toAway();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // 🔹 Cleanup
    return () => {
      // Stop heartbeat + listeners set by setupPresence
      if (presenceCleanup) presenceCleanup();

      // Mark away just in case
      toAway();

      // Remove our attached listeners
      window.removeEventListener("focus", toOnline);
      window.removeEventListener("blur", toAway);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", toOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [user?.uid]);

  useEffect(() => {
    if (user) {
      requestNotificationPermission(user);
    }
  }, [user]);

  // Foreground push
  useEffect(() => {
    const unsub = onMessage(messaging, (payload) => {
      console.log("Foreground push", payload);
      // In foreground, better to show in-app toast/snackbar, not system notification
    });
    return unsub;
  }, []);

  // 🔑 Listen for notification-click messages from Service Worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "OPEN_ROOM") {
          const { roomId } = event.data;
          console.log("ServiceWorker requested open room:", roomId);
          setPendingRoomId(roomId);
        }
      });
    }
  }, []);

  const signInGoogle = async () => {
    try {
      const provider = makeGoogleProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error("Google sign-in failed:", e);
      alert(e.message || "Sign-in failed");
    }
  };

  async function gracefulLogout() {
    try {
      if (user) {
        // 1. Stop and cleanup presence heartbeat/listeners
        if (presenceCleanupRef.current) {
          presenceCleanupRef.current();
          presenceCleanupRef.current = null;
        }

        // 2. If in a room, tell presence typing state to stop (optional)
        // stopTyping(activeRoomId, user.uid);

        // 3. Force "offline" immediately
        await goOfflineNow(user.uid);
      }
    } catch (err) {
      console.error("Presence cleanup error", err);
    } finally {
      // 4. Sign out from Firebase
      await signOut(auth);
    }
  }

  if (loading)
    return (
      <div className="h-screen grid place-items-center text-slate-400">
        Loading…
      </div>
    );
  if (!user) return <SignIn onGoogle={signInGoogle} />;

  if (!profile || !profile.setupComplete) {
    return (
      <ProfileSetup
        user={user}
        seedProfile={profile || {}}
        onComplete={(p) => setProfile(p)}
        onSignOut={() => signOut(auth)}
      />
    );
  }

  return (
    <ChatShell
      me={user}
      meProfile={profile}
      onLogout={gracefulLogout}
      initialRoomId={pendingRoomId}
    />
  );
}
