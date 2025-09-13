import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  addDoc,
  serverTimestamp,
  orderBy,
  limit,
  updateDoc,
  startAt,
  endAt,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  setupPresence,
  subscribePresence,
  updatePresence,
  startTyping,
  stopTyping,
  subscribeTyping,
} from "../lib/presence";
import { uploadAvatar, deleteMediaFiles } from "../lib/storage";

// ----------------- helpers -----------------
function normalizeGooglePhotoURL(url, size = 56) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.includes("googleusercontent.com")) {
      if (url.includes("=s"))
        return url.replace(/=s\d+(?:-[a-z])?/i, `=s${size}-c`);
      return `${url}=s${size}-c`;
    }
  } catch {}
  return url;
}
function formatTime(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const diff = (now - d) / (1000 * 60 * 60 * 24);
  if (diff < 2) return "Yesterday";
  return d.toLocaleDateString();
}
function lastSeenText(pres) {
  if (!pres) return "last seen recently";
  if (pres.state === "online") return "Online";
  const t = pres.lastActive;
  if (!t || typeof t !== "number") return "last seen recently";
  const d = new Date(t);
  const delta = Math.floor((Date.now() - d.getTime()) / 60000);
  if (delta < 1) return "last seen just now";
  if (delta < 60) return `last seen ${delta} min ago`;
  const hrs = Math.floor(delta / 60);
  if (hrs < 24) return `last seen ${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `last seen ${days} day${days > 1 ? "s" : ""} ago`;
}
async function ensureDmRoom(meUid, otherUid) {
  const dmKey = [meUid, otherUid].sort().join("_");
  const qRooms = query(
    collection(db, "rooms"),
    where("dmKey", "==", dmKey),
    limit(1)
  );
  const snap = await getDocs(qRooms);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const roomDoc = await addDoc(collection(db, "rooms"), {
    type: "dm",
    dmKey,
    memberIds: [meUid, otherUid],
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: "",
  });
  return { id: roomDoc.id, type: "dm", dmKey, memberIds: [meUid, otherUid] };
}
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint - 1}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    try {
      mq.addEventListener("change", onChange);
    } catch {
      mq.addListener(onChange);
    }
    setIsMobile(mq.matches);
    return () => {
      try {
        mq.removeEventListener("change", onChange);
      } catch {
        mq.removeListener(onChange);
      }
    };
  }, [breakpoint]);
  return isMobile;
}

export function formatTimeMMSS(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Telegram-style custom audio bubble
export function AudioBubble({ src, mine = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () =>
      setCur(Number.isFinite(a.currentTime) ? a.currentTime : 0);
    const onEnded = () => setPlaying(false);

    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play()
        .then(() => setPlaying(true))
        .catch(() => {});
    }
  }

  function seek(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const a = audioRef.current;
    if (!a || !dur) return;
    a.currentTime = ratio * dur;
  }

  return (
    <div className={`w-64 sm:w-72 ${mine ? "text-white" : "text-[#e0e0e0]"}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className={`h-10 w-10 rounded-full grid place-items-center transition-colors ${
            mine
              ? "bg-white/20 hover:bg-white/30"
              : "bg-white/10 hover:bg-white/20"
          }`}
          aria-label={playing ? "Pause" : "Play"}
          type="button"
        >
          <span className="material-symbols-outlined leading-none">
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>

        <div className="flex-1">
          <div
            className={`h-2 rounded-full cursor-pointer ${
              mine ? "bg-white/20" : "bg-white/10"
            }`}
            onClick={seek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={dur || 0}
            aria-valuenow={cur || 0}
          >
            <div
              className={`h-2 rounded-full ${
                mine ? "bg-white" : "bg-blue-400"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div
            className={`mt-1 text-[11px] select-none ${
              mine ? "text-white/80" : "text-gray-400"
            }`}
          >
            {formatTimeMMSS(cur)} / {formatTimeMMSS(dur)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- main -----------------
export default function ChatShell({ me, meProfile, onLogout, initialRoomId  }) {
  const isMobile = useIsMobile();

  const [view, setView] = useState("chats"); // 'chats' | 'settings' | 'profile'
  const [showDrawer, setShowDrawer] = useState(false);

  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState(null);

  const [peerProfiles, setPeerProfiles] = useState({});
  const [presence, setPresence] = useState({});

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showSendButton, setShowSendButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const listRef = useRef(null);

  const [showSearch, setShowSearch] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [attachModal, setAttachModal] = useState(false);
  const [attachFiles, setAttachFiles] = useState([]);
  const [lightbox, setLightbox] = useState({ open: false, url: "" });
  const [uploading, setUploading] = useState(false);

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [replyTo, setReplyTo] = useState(null);
  const [contextMenuMessageId, setContextMenuMessageId] = useState(null);


  useEffect(() => {
  if (initialRoomId) {
    console.log("Opening room from notification:", initialRoomId);
    setActiveRoomId(initialRoomId);
  }
}, [initialRoomId]);

  // common reply handler
  function handleReplyTo(message) {
    setReplyTo(message);
    setContextMenuMessageId(null); // close context menu if opened
    // wait a tick so React renders reply bar above composer, then focus input
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoveX = 0;
  let touchMoveY = 0;
  let gestureLocked = false;
  let holdTimer = null;

  // close menu when clicking outside
  useEffect(() => {
    const close = () => setContextMenuMessageId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  //voice record functions
  // State additions for the new functionality
  const [isPaused, setIsPaused] = useState(false);
  const [recordTimer, setRecordTimer] = useState("0:00");
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [pausedTime, setPausedTime] = useState(0);
  const timerRef = useRef(null);
  const finalizeRef = useRef(false);

  // Timer effect with pause support
  useEffect(() => {
    if (recording && !isPaused) {
      const startTime = Date.now() - pausedTime;
      setRecordingStartTime(startTime);

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const min = Math.floor(elapsed / 60);
        const sec = String(elapsed % 60).padStart(2, "0");
        setRecordTimer(`${min}:${sec}`);
      }, 1000);
    } else {
      clearInterval(timerRef.current);

      // When pausing, store how long we've been paused
      if (isPaused && recording) {
        setPausedTime(Date.now() - recordingStartTime);
      }
    }

    return () => clearInterval(timerRef.current);
  }, [recording, isPaused]);

  // Reset timer when not recording
  useEffect(() => {
    if (!recording) {
      setRecordTimer("0:00");
      setPausedTime(0);
      setIsPaused(false);
      setIsRecordingLocked(false);
    }
  }, [recording]);

  function togglePauseRecord() {
    if (!mediaRecorderRef.current) return;

    if (!isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    } else {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  }

  function toggleLockRecording() {
    setIsRecordingLocked(!isRecordingLocked);
  }

  function finalizeRecording() {
    finalizeRef.current = true; // mark that we want upload
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }
  const [isCancelled, setIsCancelled] = useState(false);
  function cancelRecording() {
    setIsCancelled(true);
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }
  // At the top of ChatShell component (after your other states/refs)
  const holdDuration = 1500; // 1.5 seconds
  const [deleteConfirm, setDeleteConfirm] = useState({
    open: false,
    message: null,
  });

  // group add
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupAvatar, setGroupAvatar] = useState(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // profile view
  const [showProfile, setShowProfile] = useState(false);
  const [profileViewUid, setProfileViewUid] = useState(null);

  // group management
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [groupAddMembers, setGroupAddMembers] = useState([]);
  const [addingMembers, setAddingMembers] = useState(false);

  // shared media for profile
  const [sharedMedia, setSharedMedia] = useState([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // friends for group add convenience
  const [friends, setFriends] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(true);

  const inputRef = useRef(null);

  //audio player fixed
  // Audio player state
  const [currentAudio, setCurrentAudio] = useState(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlayerPosition, setAudioPlayerPosition] = useState({
    x: 20,
    y: 20,
  });
  const [isDragging, setIsDragging] = useState(false);
  const audioRef = useRef(null);

  // Audio player functions
  const handlePlayAudio = (audioMessage) => {
    setCurrentAudio(audioMessage);
    setIsAudioPlaying(true);
  };

  const toggleAudioPlayback = () => {
    if (isAudioPlaying) {
      audioRef.current?.pause();
    } else {
      audioRef.current?.play();
    }
    setIsAudioPlaying(!isAudioPlaying);
  };

  const handleAudioTimeUpdate = () => {
    setAudioCurrentTime(audioRef.current?.currentTime || 0);
  };

  const handleAudioLoaded = () => {
    setAudioDuration(audioRef.current?.duration || 0);
  };

  const handleAudioEnded = () => {
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
  };

  const handleAudioSeek = (e) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * audioDuration;
    audioRef.current.currentTime = newTime;
    setAudioCurrentTime(newTime);
  };

  useEffect(() => {
    const close = () => setContextMenuMessageId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Drag and drop functions
  const handleAudioPlayerDragStart = (e) => {
    if (e.target.closest("button")) return; // Don't drag if clicking buttons

    setIsDragging(true);
    const startX = e.clientX - audioPlayerPosition.x;
    const startY = e.clientY - audioPlayerPosition.y;

    const handleDrag = (moveEvent) => {
      setAudioPlayerPosition({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY,
      });
    };

    const handleDragEnd = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  };
  const [typingUsers, setTypingUsers] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeout = useRef(null);

  useEffect(() => {
    if (!activeRoomId) return;

    const unsub = subscribeTyping(activeRoomId, (typingData) => {
      setTypingUsers(typingData);
    });

    return () => unsub();
  }, [activeRoomId]);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Load friends from existing DMs
  useEffect(() => {
    const loadFriends = async () => {
      setLoadingFriends(true);
      try {
        const qRooms = query(
          collection(db, "rooms"),
          where("memberIds", "array-contains", me.uid),
          where("type", "==", "dm")
        );
        const snap = await getDocs(qRooms);
        const friendIds = new Set();
        snap.docs.forEach((d) => {
          const room = d.data();
          (room.memberIds || []).forEach((id) => {
            if (id !== me.uid) friendIds.add(id);
          });
        });
        const friendDocs = await Promise.all(
          Array.from(friendIds).map((uid) => getDoc(doc(db, "profiles", uid)))
        );
        const list = friendDocs
          .filter((s) => s.exists())
          .map((s) => ({ id: s.id, ...s.data() }));
        setFriends(list);
      } catch (e) {
        console.error("Error loading friends:", e);
      } finally {
        setLoadingFriends(false);
      }
    };
    loadFriends();
  }, [me.uid, rooms]);

  // Unread notifications (unchanged core)
  useEffect(() => {
    const showNotification = (message, room, senderProfile) => {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      let title, body;
      if (room.type === "dm") {
        title =
          senderProfile?.displayName || senderProfile?.username || "Unknown";
        body =
          message.type === "text"
            ? message.text
            : message.type === "image"
            ? "Sent a photo"
            : "Sent a voice message";
      } else {
        title = room.title || "Group";
        const senderName =
          senderProfile?.displayName || senderProfile?.username || "Unknown";
        body = `${senderName}: ${
          message.type === "text"
            ? message.text
            : message.type === "image"
            ? "Sent a photo"
            : "Sent a voice message"
        }`;
      }
      if (body.length > 100) body = body.slice(0, 100) + "…";
      new Notification(title, { body, icon: "/logo-swiftly.svg" });
    };
    rooms.forEach((room) => {
      if (room.unreadCount > 0) {
        const qLast = query(
          collection(db, "rooms", room.id, "messages"),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const unsub = onSnapshot(qLast, (snap) => {
          if (!snap.empty) {
            const message = snap.docs[0].data();
            if (message.senderId === me.uid) return;
            getDoc(doc(db, "profiles", message.senderId)).then((s) => {
              if (s.exists()) showNotification(message, room, s.data());
            });
          }
        });
        return () => unsub();
      }
    });
  }, [rooms, me.uid]);

  // Create group
  async function createGroup() {
    if (!groupName.trim() || groupMembers.length === 0) return;
    setCreatingGroup(true);
    try {
      let avatarUrl = "";
      if (groupAvatar) avatarUrl = await uploadAvatar(groupAvatar, me.uid);
      const groupDoc = await addDoc(collection(db, "rooms"), {
        type: "group",
        title: groupName.trim(),
        description: groupDescription.trim(),
        avatarUrl,
        memberIds: [me.uid, ...groupMembers.map((m) => m.id)],
        adminIds: [me.uid],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: "",
      });
      setShowCreateGroup(false);
      setGroupName("");
      setGroupDescription("");
      setGroupMembers([]);
      setGroupAvatar(null);
      setGroupAvatarPreview("");
      setView("chats");
      setActiveRoomId(groupDoc.id);
    } catch (e) {
      console.error("Create group error:", e);
      alert("Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function addMembersToGroup() {
    if (!activeRoomId || groupAddMembers.length === 0) return;
    setAddingMembers(true);
    try {
      const roomRef = doc(db, "rooms", activeRoomId);
      await updateDoc(roomRef, {
        memberIds: arrayUnion(...groupAddMembers.map((m) => m.id)),
      });
      setShowAddMembers(false);
      setGroupAddMembers([]);
      alert("Members added successfully");
    } catch (e) {
      console.error("Add members error:", e);
      alert("Failed to add members");
    } finally {
      setAddingMembers(false);
    }
  }

  function toggleGroupMember(profile, isAddModal = false) {
    if (isAddModal) {
      setGroupAddMembers((prev) => {
        const exists = prev.some((m) => m.id === profile.id);
        return exists
          ? prev.filter((m) => m.id !== profile.id)
          : [...prev, profile];
      });
    } else {
      setGroupMembers((prev) => {
        const exists = prev.some((m) => m.id === profile.id);
        if (exists) return prev.filter((m) => m.id !== profile.id);
        if (prev.length < 99) return [...prev, profile];
        alert("Maximum group size is 100 members");
        return prev;
      });
    }
  }

  function handleGroupAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please choose an image");
    setGroupAvatar(file);
    setGroupAvatarPreview(URL.createObjectURL(file));
  }

  function roomTitle(r) {
    if (r.type === "group") return r.title || "Group";
    const pid = r.memberIds?.find((id) => id !== me.uid);
    const p = pid ? peerProfiles[pid] : null;
    return p?.displayName || p?.username || "User";
  }
  function roomAvatar(r) {
    if (r.type === "group") {
      if (
        r.avatarUrl &&
        (r.avatarUrl.startsWith("http://") ||
          r.avatarUrl.startsWith("https://"))
      )
        return r.avatarUrl;
      return null;
    }
    const pid = r.memberIds?.find((id) => id !== me.uid);
    const p = pid ? peerProfiles[pid] : null;
    return normalizeGooglePhotoURL(p?.photoURL || "", 56);
  }

  const [groupSearchTerm, setGroupSearchTerm] = useState("");
  useEffect(() => {
    const searchUsers = async () => {
      const term = groupSearchTerm.trim().toLowerCase();
      if (term.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const qUsers = query(
          collection(db, "profiles"),
          orderBy("usernameLower"),
          startAt(term),
          endAt(term + "\uf8ff"),
          limit(25)
        );
        const snap = await getDocs(qUsers);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.setupComplete && p.uid !== me.uid);
        setResults(list);
      } finally {
        setSearching(false);
      }
    };
    const t = setTimeout(searchUsers, 250);
    return () => clearTimeout(t);
  }, [groupSearchTerm, me.uid]);

  // presence (me)
  useEffect(() => {
    if (!me.uid) return;
    const cleanup = setupPresence(me.uid);
    return cleanup; // remove listeners + heartbeat on unmount
  }, [me.uid]);

  // close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target))
        setShowMenu(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // rooms
  useEffect(() => {
    setLoadingRooms(true);
    const qRooms = query(
      collection(db, "rooms"),
      where("memberIds", "array-contains", me.uid)
    );
    const unsub = onSnapshot(qRooms, async (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const ta = a.lastMessageAt?.toMillis?.() ?? 0;
        const tb = b.lastMessageAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      setRooms(list);
      setLoadingRooms(false);
      const toFetch = new Set();
      list.forEach((r) => {
        if (Array.isArray(r.memberIds))
          r.memberIds.forEach((id) => {
            if (id !== me.uid && !peerProfiles[id]) toFetch.add(id);
          });
      });
      if (toFetch.size) {
        const batch = await Promise.all(
          Array.from(toFetch).map((uid) => getDoc(doc(db, "profiles", uid)))
        );
        const map = {};
        batch.forEach((s) => {
          if (s.exists()) map[s.id] = s.data();
        });
        setPeerProfiles((prev) => ({ ...prev, ...map }));
      }
    });
    return unsub;
    // eslint-disable-next-line
  }, [me.uid]);

  // keep keyboard open in composer
  const keepKbFocus = (e) => {
    const t = e.target;
    if (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT"
    )
      return;
    if (t.closest("[data-ignore-keep-kb]")) return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  // messages of active room
  useEffect(() => {
    if (!activeRoomId || view !== "chats") {
      setMessages([]);
      return;
    }
    const qMsgs = query(
      collection(db, "rooms", activeRoomId, "messages"),
      orderBy("createdAt", "asc"),
      limit(400)
    );
    const unsub = onSnapshot(qMsgs, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(list);
    });
    return unsub;
  }, [activeRoomId, view]);


  // scroll watcher
  useEffect(() => {
    const handleScroll = () => {
      if (!listRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAtBottom(atBottom);
      setShowScrollToBottom(!atBottom && scrollHeight > clientHeight + 100);
    };
    if (listRef.current) {
      listRef.current.addEventListener("scroll", handleScroll);
      return () => listRef.current?.removeEventListener("scroll", handleScroll);
    }
  }, [messages]);

  useEffect(() => {
    if (listRef.current && isAtBottom) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isAtBottom]);

  // search overlay
  useEffect(() => {
    const t = setTimeout(async () => {
      const term = queryText.trim().toLowerCase();
      if (!showSearch || term.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const qUsers = query(
          collection(db, "profiles"),
          orderBy("usernameLower"),
          startAt(term),
          endAt(term + "\uf8ff"),
          limit(25)
        );
        const snap = await getDocs(qUsers);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.setupComplete && p.uid !== me.uid);
        setResults(list);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [queryText, showSearch, me.uid]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );
  const peerId =
    activeRoom?.type === "dm"
      ? activeRoom.memberIds?.find((id) => id !== me.uid)
      : null;
  const peer = peerId ? peerProfiles[peerId] : null;
  const peerAvatar = normalizeGooglePhotoURL(peer?.photoURL || "", 40);
  const peerPresence = peerId ? presence[peerId] : null;

  const showMobileChat = isMobile && !!activeRoomId && view === "chats";
  const showMobileProfile = isMobile && view === "profile";

  // shared media: load when profile view opens
  useEffect(() => {
    let cancelled = false;
    async function loadMedia() {
      if (!showProfile || !activeRoomId) return;
      setLoadingMedia(true);
      try {
        // fetch recent messages and filter client-side to avoid composite index requirements
        const qRecent = query(
          collection(db, "rooms", activeRoomId, "messages"),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const snap = await getDocs(qRecent);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => m.type === "image" || m.type === "audio");
        if (!cancelled) setSharedMedia(list);
      } catch (e) {
        console.error("load media error", e);
      } finally {
        if (!cancelled) setLoadingMedia(false);
      }
    }
    loadMedia();
    return () => {
      cancelled = true;
    };
  }, [showProfile, activeRoomId]);

  async function startDmWith(uid) {
    if (!uid || uid === me.uid) return;
    try {
      const room = await ensureDmRoom(me.uid, uid);
      setShowSearch(false);
      setView("chats");
      setActiveRoomId(room.id);
    } catch (e) {
      console.error("Create DM error:", e);
    }
  }

  async function sendMessage() {
  const t = text.trim();
  if (!t || !activeRoomId) return;
  setSending(true);

  try {
    const roomRef = doc(db, "rooms", activeRoomId);

    // Save the message
    await addDoc(collection(roomRef, "messages"), {
      senderId: me.uid,
      type: "text",
      text: t.slice(0, 4000),
      replyTo: replyTo?.id || null,
      createdAt: serverTimestamp(),
      readBy: [me.uid],
    });

    // Grab the room
    const snap = await getDoc(roomRef);
    const data = snap.data();

    // Prepare updates for unread counters
    const updates = {
      lastMessageAt: serverTimestamp(),
      lastMessagePreview: t.slice(0, 80),
    };

    (data.memberIds || []).forEach((uid) => {
      if (uid === me.uid) {
        updates[`unread.${uid}`] = 0;
      } else {
        updates[`unread.${uid}`] = increment(1);
      }
    });

    await updateDoc(roomRef, updates);

    // 👉 NEW: Gather FCM tokens of recipients
    const recipientTokens = [];
    for (const uid of data.memberIds || []) {
      if (uid !== me.uid) {
        const userSnap = await getDoc(doc(db, "profiles", uid));
        if (userSnap.exists() && userSnap.data().fcmToken) {
          recipientTokens.push(userSnap.data().fcmToken);
        }
      }
    }

    // 👉 NEW: Call backend to send push
    if (recipientTokens.length > 0) {
      await fetch("https://testing4234.pythonanywhere.com/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tokens: recipientTokens,
    senderName: me.displayName || "Someone",
    senderPhoto: me.photoURL,
    roomId: activeRoomId,
    roomTitle: data.title || "Group",
    roomType: data.type, // "dm" or "group"
    msgType: "text",     // "text" / "image" / "audio"
    body: t              // the actual message text
  }),
});
    }

    // Reset UI
    setText("");
    setShowSendButton(false);
    setReplyTo(null);

    if (listRef.current) {
      setTimeout(() => {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 0);
    }
  } catch (err) {
    console.error("sendMessage failed:", err);
  } finally {
    setSending(false);
  }
}

  async function resetUnread(roomId, uid) {
    if (!roomId || !uid) return;
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        [`unread.${uid}`]: 0,
      });
    } catch (e) {
      console.error("resetUnread failed", e);
    }
  }

  

  const isActiveViewer =
    activeRoom &&
    activeRoomId === activeRoom.id &&
    view === "chats" &&
    document.visibilityState === "visible" &&
    document.hasFocus();

  const myUnread = isActiveViewer ? 0 : activeRoom?.unread?.[me.uid] || 0;

  useEffect(() => {
    if (!activeRoomId || view !== "chats") return;

    const tryResetUnread = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        if ((activeRoom?.unread?.[me.uid] || 0) > 0) {
          resetUnread(activeRoomId, me.uid);
        }
      }
    };

    window.addEventListener("focus", tryResetUnread);
    document.addEventListener("visibilitychange", tryResetUnread);

    return () => {
      window.removeEventListener("focus", tryResetUnread);
      document.removeEventListener("visibilitychange", tryResetUnread);
    };
  }, [activeRoomId, view, me.uid]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notification, setNotification] = useState({
    show: false,
    message: "",
    type: "",
  });
  const showNotification = (message, type = "info") => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification({ show: false, message: "", type: "" });
    }, 3000);
  };

  // Subscribe to presence for DM peers + active group's members
  useEffect(() => {
    const dmPeers = Array.from(
      new Set(
        rooms
          .filter((r) => r.type === "dm" && Array.isArray(r.memberIds))
          .map((r) => r.memberIds.find((id) => id !== me.uid))
          .filter(Boolean)
      )
    );

    const groupPeers =
      activeRoom?.type === "group"
        ? (activeRoom.memberIds || []).filter((id) => id !== me.uid)
        : [];

    const ids = Array.from(new Set([...dmPeers, ...groupPeers]));
    if (ids.length === 0) return;

    const unsub = subscribePresence(ids, (uid, data) =>
      setPresence((prev) => ({ ...prev, [uid]: data }))
    );
    return unsub;
  }, [rooms, activeRoom?.id, activeRoom?.type, me.uid]);

  // Notification component JSX (add this at the end of your return statement)
  {
    notification.show && (
      <div
        className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all duration-300 transform ${
          notification.type === "success"
            ? "bg-green-600"
            : notification.type === "error"
            ? "bg-red-600"
            : "bg-blue-600"
        } ${
          notification.show
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">
            {notification.type === "success"
              ? "check_circle"
              : notification.type === "error"
              ? "error"
              : "info"}
          </span>
          {notification.message}
        </div>
      </div>
    );
  }

  const deleteChat = async () => {
    if (!activeRoomId) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);

    try {
      console.log("Starting chat deletion for room:", activeRoomId);

      // Get all messages first to find media files
      const msgs = await getDocs(
        collection(db, "rooms", activeRoomId, "messages")
      );

      console.log("Found", msgs.docs.length, "messages to delete");

      // Extract media URLs from messages
      const mediaUrls = [];
      msgs.docs.forEach((doc) => {
        const msg = doc.data();
        if (msg.type === "image" && msg.imageUrl) {
          console.log("Found image URL:", msg.imageUrl);
          mediaUrls.push(msg.imageUrl);
        } else if (msg.type === "audio" && msg.audioUrl) {
          console.log("Found audio URL:", msg.audioUrl);
          mediaUrls.push(msg.audioUrl);
        }
      });

      console.log("Found", mediaUrls.length, "media files to delete");

      // Debug: Log the actual URLs to see their format
      mediaUrls.forEach((url, index) => {
        console.log(`URL ${index + 1}:`, url);

        // Try to parse the URL to see what we get
        try {
          const urlObj = new URL(url);
          console.log(`URL ${index + 1} parsed:`, {
            hostname: urlObj.hostname,
            pathname: urlObj.pathname,
            pathParts: urlObj.pathname.split("/"),
          });
        } catch (e) {
          console.log(`URL ${index + 1} parsing failed:`, e);
        }
      });

      // Delete media files from Supabase storage
      if (mediaUrls.length > 0) {
        try {
          console.log("Attempting to delete media files...");
          const result = await deleteMediaFiles(mediaUrls);
          console.log("Media deletion result:", result);

          if (result.success) {
            console.log("Media files deleted successfully");
            showNotification(
              `Deleted ${result.deleted} media files`,
              "success"
            );
          } else {
            console.log("Media deletion partially failed");
            showNotification("Some media files couldn't be deleted", "warning");
          }
        } catch (mediaError) {
          console.error("Error deleting media files:", mediaError);
          showNotification("Failed to delete media files", "error");
          // Continue with chat deletion even if media deletion fails
        }
      }

      // Delete messages from Firestore
      console.log("Deleting messages from Firestore...");
      const deletePromises = msgs.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      console.log("Messages deleted from Firestore");

      // Delete the chat room
      console.log("Deleting chat room...");
      await deleteDoc(doc(db, "rooms", activeRoomId));
      console.log("Chat room deleted");

      setActiveRoomId(null);
      setShowMenu(false);

      showNotification("Chat deleted successfully", "success");
    } catch (e) {
      console.error("Delete chat error:", e);
      showNotification("Failed to delete chat: " + e.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  function handleSelectPhotos(e) {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (!files.length) return;
    setAttachFiles(files);
    setAttachModal(true);
    e.target.value = "";
  }
  async function sendAttachedPhotos() {
    if (!activeRoomId || !attachFiles.length) return;
    setUploading(true);
    try {
      for (const f of attachFiles) {
        const imageUrl = await uploadAvatar(f, me.uid);
        await addDoc(collection(db, "rooms", activeRoomId, "messages"), {
          senderId: me.uid,
          type: "image",
          imageUrl,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "rooms", activeRoomId), {
          lastMessageAt: serverTimestamp(),
          lastMessagePreview: "Photo",
        });
      }
      setAttachFiles([]);
      setAttachModal(false);
      if (listRef.current)
        setTimeout(() => {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 0);
    } finally {
      setUploading(false);
    }
  }

  function openLightbox(url) {
    setLightbox({ open: true, url });
  }

  async function toggleRecord() {
    if (!activeRoomId) return;
    if (!recording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
        mediaRecorderRef.current = mr;
        chunksRef.current = [];

        mr.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };

        mr.onstop = async () => {
          if (isCancelled) {
            // ❌ cancelled → do nothing
            setIsCancelled(false);
            chunksRef.current = [];
            return;
          }

          // ✅ Only send when finalizeRecording called
          if (finalizeRef.current) {
            finalizeRef.current = false;
            const blob = new Blob(chunksRef.current, { type: "audio/webm" });
            const file = new File([blob], `voice-${Date.now()}.webm`, {
              type: "audio/webm",
            });

            try {
              const audioUrl = await uploadAvatar(file, me.uid);
              await addDoc(collection(db, "rooms", activeRoomId, "messages"), {
                senderId: me.uid,
                type: "audio",
                audioUrl,
                createdAt: serverTimestamp(),
              });
              await updateDoc(doc(db, "rooms", activeRoomId), {
                lastMessageAt: serverTimestamp(),
                lastMessagePreview: "Voice message",
              });
            } catch (e) {
              console.error("Voice upload error", e);
            }
          }

          chunksRef.current = [];
        };

        mr.start();
        setRecording(true);
      } catch {
        alert("Mic permission denied");
      }
    }
  }

  const welcomeBlock = (
    <div className="flex flex-col items-center justify-center min-h-screen text-center bg-[#1f2b38]">
      <div className="flex items-center justify-center w-24 h-24 bg-[#1f2b38] rounded-full">
        <span className="material-symbols-outlined text-7xl text-blue-400">
          chat_bubble
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-bold">Welcome to Swiftly</h2>
      <p className="mt-2 text-gray-400">Select a chat to start messaging.</p>
    </div>
  );

  const profileData = profileViewUid
    ? profileViewUid === me.uid
      ? meProfile
      : peerProfiles[profileViewUid]
    : null;

  const openProfileFromMenu = () => {
    setShowMenu(false);
    // For DM we show peer; for group we show group info (no specific uid)
    setProfileViewUid(activeRoom?.type === "dm" ? peerId : null);
    if (isMobile) {
      setView("profile");
      setShowProfile(true);
    } else {
      setShowProfile(true);
      // keep view = 'chats' on desktop
    }
  };

  useEffect(() => {
    // push a state whenever important navigation changes
    const state = {
      view,
      activeRoomId,
      showProfile,
      profileViewUid,
    };
    window.history.pushState(state, "");
  }, [view, activeRoomId, showProfile, profileViewUid]);

  useEffect(() => {
    const handlePop = (e) => {
      e.preventDefault();

      // Pop state handling:
      if (showProfile) {
        // if currently showing profile → close it
        setShowProfile(false);
      } else if (activeRoomId) {
        // if in a chat → back to chat list
        setActiveRoomId(null);
        setView("chats");
      } else if (view !== "chats") {
        // if in settings → go to chat list
        setView("chats");
      } else {
        // already in chat list → exit app (or stay)
        console.log("At root, let Android close app");
      }
    };

    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [view, activeRoomId, showProfile]);


useEffect(() => {
  if (!activeRoomId || view !== "chats") return;

  const tryMarkAsRead = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      // Reset unread bubble
      if ((activeRoom?.unread?.[me.uid] || 0) > 0) {
        resetUnread(activeRoomId, me.uid);
      }

      // Mark per-message receipts
      const unread = messages.filter(
        (m) => m.senderId !== me.uid && !(m.readBy || []).includes(me.uid)
      );

      unread.forEach(async (m) => {
        try {
          await updateDoc(doc(db, "rooms", activeRoomId, "messages", m.id), {
            readBy: arrayUnion(me.uid),
          });
        } catch {}
      });
    }
  };

  tryMarkAsRead(); // run immediately if conditions are valid
  window.addEventListener("focus", tryMarkAsRead);
  document.addEventListener("visibilitychange", tryMarkAsRead);

  return () => {
    window.removeEventListener("focus", tryMarkAsRead);
    document.removeEventListener("visibilitychange", tryMarkAsRead);
  };
}, [messages, activeRoomId, view, me.uid, activeRoom?.unread]);

  // ----------------- UI -----------------
  return (
    <div
      className="bg-[#18222d] text-[#e0e0e0] flex overflow-hidden min-h-0 h-screen"
      style={{ fontFamily: "Exo 2, sans-serif", height: "100svh" }}
    >
      {/* LEFT: chat list or (on mobile) settings/profile */}
      <aside
        className={`${
          isMobile && activeRoomId && view === "chats" ? "hidden" : "flex"
        } flex-col w-full md:w-80 lg:w-96 border-r border-gray-700 bg-[#1f2b38] flex-shrink-0 relative min-h-0`}
      >
        {/* Header: sticky */}
        <header className="z-20 sticky top-0 flex items-center justify-between p-4 border-b border-gray-700 bg-[#1f2b38]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="p-2 rounded-full hover:bg-gray-700 hidden md:inline-flex "
              onClick={() => setShowDrawer(true)}
              aria-label="Menu"
            >
              <span className="material-symbols-outlined leading-none">
                menu
              </span>
            </button>
            <h1 className="text-xl font-bold">Swiftly</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
              onClick={() => setShowSearch(true)}
            >
              <span className="material-symbols-outlined leading-none">
                search
              </span>
            </button>
            <button
              type="button"
              className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
            >
              <span className="material-symbols-outlined leading-none">
                edit
              </span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto md:pt-0 pb-20 md:pb-0 min-h-0 scrollbar-telegram">
          {isMobile && view === "settings" ? (
            <MobileSettingsView
              meProfile={meProfile}
              onBack={() => setView("chats")}
              onLogout={onLogout}
            />
          ) : isMobile && view === "profile" ? (
            <ProfileView
              profile={profileData}
              presence={presence[profileViewUid]}
              onBack={() => setView("chats")}
              isMe={profileViewUid === me.uid}
              sharedMedia={sharedMedia}
              loadingMedia={loadingMedia}
              activeRoom={activeRoom}
              onAddMembers={() => setShowAddMembers(true)}
              onOpenImage={openLightbox}
              onPlayAudio={handlePlayAudio} // Make sure this line is present
              isAdmin={!!(activeRoom?.adminIds || []).includes(me.uid)}
            />
          ) : loadingRooms ? (
            <ul className="divide-y divide-gray-700">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex items-center gap-4 p-4">
                  <div className="h-14 w-14 rounded-full bg-gray-700 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/2 bg-gray-700 rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-gray-800 rounded animate-pulse" />
                  </div>
                </li>
              ))}
            </ul>
          ) : rooms.length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              <div className="inline-block p-6 bg-[#1f2b38] rounded-full mb-2">
                <span className="material-symbols-outlined text-4xl text-blue-400 leading-none">
                  chat
                </span>
              </div>
              <div className="font-semibold text-white">No chats yet</div>
              <div className="text-sm">
                Search a username to start a conversation.
              </div>
              <div className="mt-3">
                <button
                  onClick={() => setShowSearch(true)}
                  className="px-3 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-sm"
                >
                  Search users
                </button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-gray-700">
              {rooms.map((r) => {
                // --- Room basics ---
                const active = r.id === activeRoomId && view === "chats";
                const title = roomTitle(r);
                const avatar = roomAvatar(r);
                const time = formatTime(r.lastMessageAt);
                const last = r.lastMessagePreview || "";

                // --- DM peer presence ---
                const pid =
                  r.type === "dm"
                    ? r.memberIds?.find((id) => id !== me.uid)
                    : null;
                const isOnline = pid && presence[pid]?.state === "online";

                // --- Unread logic ---
                const isActiveViewer =
                  r.id === activeRoomId &&
                  view === "chats" &&
                  document.visibilityState === "visible" &&
                  document.hasFocus();

                const myUnread = isActiveViewer ? 0 : r.unread?.[me.uid] || 0;

                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-4 p-4 hover:bg-gray-700/50 cursor-pointer ${
                      active ? "bg-blue-500/20" : ""
                    }`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setView("chats");
                      setActiveRoomId(r.id);
                      setShowProfile(false);
                      if (!isMobile) {
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }
                    }}
                  >
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={title}
                          className="h-14 w-14 rounded-full object-cover ring-2 ring-[#1f2b38]"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = "/logo-swiftly.svg";
                          }}
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                          {title.slice(0, 1)}
                        </div>
                      )}
                      {isOnline && (
                        <div className="absolute bottom-[2px] right-[2px] h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#1f2b38]" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <h3 className="font-semibold truncate">{title}</h3>
                        <p className="text-xs text-gray-400 flex-shrink-0 ml-2">
                          {time}
                        </p>
                      </div>

                      <div className="flex justify-between items-center mt-1">
                        {/* Last message preview */}
                        <p className="text-sm text-gray-300 truncate">
                          {last || "Say hi 👋"}
                        </p>

                        {/* Unread counter badge */}
                        {myUnread > 0 && (
                          <span
                            className="bg-blue-500 text-white text-[11px] font-medium px-[6px] min-w-[20px] h-5 flex items-center justify-center rounded-full ml-2"
                            aria-label={`${myUnread} unread messages`}
                          >
                            {myUnread > 999
                              ? "999+"
                              : myUnread > 50
                              ? "50+"
                              : myUnread}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Bottom bar (mobile) – hides while in chat */}
        {isMobile && !(activeRoomId && view === "chats") && (
          <nav className="fixed bottom-0 left-0 right-0 bg-[#1f2b38] border-t border-gray-700 flex justify-around p-2">
            <button
              className={`flex flex-col items-center gap-1 w-1/2 ${
                view === "chats" ? "text-blue-400" : "text-gray-400"
              }`}
              onClick={() => {
                setView("chats");
                setActiveRoomId(null);
                setShowProfile(false);
              }}
            >
              <span className="material-symbols-outlined leading-none">
                chat_bubble
              </span>
              <span className="text-xs">Chats</span>
            </button>
            <button
              className={`flex flex-col items-center gap-1 w-1/2 ${
                view === "settings" ? "text-blue-400" : "text-gray-400"
              }`}
              onClick={() => {
                setView("settings");
                setActiveRoomId(null);
                setShowProfile(false);
              }}
            >
              <span className="material-symbols-outlined leading-none">
                settings
              </span>
              <span className="text-xs">Settings</span>
            </button>
          </nav>
        )}
      </aside>

      {/* RIGHT: desktop main panel */}
      {!isMobile && (
        <main className="flex-1 flex flex-col bg-[#18222d] min-h-0 relative">
          {view === "settings" ? (
            <SettingsView
              meProfile={meProfile}
              onClose={() => setView("chats")}
              onLogout={onLogout}
            />
          ) : !activeRoom ? (
            <div className="flex flex-col items-center justify-center min-h-screen text-center">
              <div className="flex items-center justify-center w-24 h-24 bg-[#1f2b38] rounded-full">
                <span className="material-symbols-outlined text-8xl text-blue-400">
                  chat_bubble
                </span>
              </div>
              <h2 className="mt-6 text-2xl font-bold">Welcome to Swiftly</h2>
              <p className="mt-2 text-gray-400">
                Select a chat to start messaging.
              </p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <header className="sticky top-0 z-10 flex items-center p-4 border-b border-gray-700 bg-[#1f2b38]">
                {activeRoom?.type === "group" ? (
                  <>
                    <div className="relative mr-3">
                      {activeRoom.avatarUrl ? (
                        <img
                          src={activeRoom.avatarUrl}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover ring-2 ring-[#1f2b38]"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                          {(activeRoom.title || "G").slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold truncate">
                        {activeRoom.title || "Group"}
                      </h2>
                      <p className="text-sm text-gray-400 truncate">
                        {/* ---- Group typing logic ---- */}
                        {(() => {
                          const typingIds = Object.keys(
                            typingUsers || {}
                          ).filter((id) => id !== me.uid);
                          if (typingIds.length === 1) {
                            const user = peerProfiles[typingIds[0]];
                            return `${
                              user?.displayName || user?.username || "Someone"
                            } is typing…`;
                          } else if (typingIds.length > 1) {
                            return `${typingIds.length} people typing…`;
                          } else {
                            return `${
                              activeRoom.memberIds?.length || 0
                            } members • ${
                              activeRoom.memberIds?.filter(
                                (id) => presence[id]?.state === "online"
                              ).length || 0
                            } online`;
                          }
                        })()}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative mr-3">
                      {peerAvatar ? (
                        <img
                          src={peerAvatar}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover ring-2 ring-[#1f2b38]"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = "/logo-swiftly.svg";
                          }}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                          {(peer?.displayName || peer?.username || "U").slice(
                            0,
                            1
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold truncate">
                        {peer?.displayName || peer?.username || "User"}
                      </h2>
                      <p className="text-sm text-gray-400 truncate">
                        {/* ---- DM typing logic ---- */}
                        {Object.keys(typingUsers || {}).some(
                          (id) => id !== me.uid
                        )
                          ? "typing…"
                          : lastSeenText(peerPresence)}
                      </p>
                    </div>
                  </>
                )}

                <div className="flex items-center gap-2">
                  <button className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center">
                    <span className="material-symbols-outlined leading-none">
                      call
                    </span>
                  </button>
                  <button className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center">
                    <span className="material-symbols-outlined leading-none">
                      search
                    </span>
                  </button>
                  <button
                    className="p-2 rounded-full hover:bg-gray-700 relative  flex items-center justify-center"
                    ref={menuRef}
                    onClick={(e) => {
                      e.stopPropagation(); // prevent the click from bubbling
                      setShowMenu((v) => !v);
                    }}
                  >
                    <span className="material-symbols-outlined leading-none">
                      more_vert
                    </span>

                    {showMenu && (
                      <div
                        className="absolute right-0 top-full mt-1 bg-[#1f2b38] border border-gray-700 rounded-lg shadow-lg z-50 w-48"
                        onClick={(e) => e.stopPropagation()} // prevent menu clicks from bubbling
                      >
                        <div
                          onClick={() => {
                            openProfileFromMenu();
                            setShowMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            person
                          </span>
                          {activeRoom.type === "group"
                            ? "Group Info"
                            : "View Profile"}
                        </div>

                        {activeRoom.type === "group" &&
                          activeRoom.adminIds?.includes(me.uid) && (
                            <div
                              onClick={() => {
                                setShowAddMembers(true);
                                setShowMenu(false);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-sm leading-none">
                                group_add
                              </span>
                              Add Members
                            </div>
                          )}

                        <div
                          onClick={() => {
                            deleteChat();
                            setShowMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-700 text-red-400 flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            delete
                          </span>
                          Delete Chat
                        </div>
                      </div>
                    )}
                  </button>
                </div>
              </header>

              {/* Messages container with relative positioning for the scroll button */}
              <div className="flex-1 min-h-0 overflow-hidden relative">
                <div
                  ref={listRef}
                  className="h-full overflow-y-auto scrollbar-telegram p-4 lg:p-6 space-y-4 lg:space-y-6"
                >
                  {messages.length === 0 ? (
                    <div className="text-center text-gray-400 text-sm pt-8">
                      No messages yet — say hello!
                    </div>
                  ) : (
                    messages.map((m) => {
                      const mine = m.senderId === me.uid;
                      const isGroup = activeRoom?.type === "group";
                      const senderProfile = isGroup
                        ? peerProfiles[m.senderId]
                        : null;
                      const senderName =
                        senderProfile?.displayName ||
                        senderProfile?.username ||
                        "Unknown";
                      const isReadByPeer =
                        !isGroup &&
                        !!peerId &&
                        (m.readBy || []).includes(peerId);

                      return (
                        <div
                          key={m.id}
                          className={`flex ${
                            mine ? "justify-end" : "justify-start"
                          }`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenuMessageId(m.id); // 👈 this state tracks which bubble has an open menu
                          }}
                        >
                          <div
                            className={`relative max-w-[85%] sm:max-w-xs lg:max-w-md p-3 rounded-lg shadow-sm ${
                              mine
                                ? "bg-blue-700 text-white rounded-br-none"
                                : "bg-[#1f2b38] text-[#e0e0e0] rounded-bl-none border border-white/5"
                            }`}
                          >
                            {/* Show sender name in groups */}
                            {isGroup && !mine && (
                              <div className="text-xs font-medium text-gray-400 mb-1">
                                {senderName}
                              </div>
                            )}

                            {/* Reply snippet */}
                            {m.replyTo && (
                              <div className="text-xs text-gray-400 border-l-2 border-blue-500 pl-2 mb-1">
                                {messages.find((msg) => msg.id === m.replyTo)
                                  ?.text ||
                                  (messages.find((msg) => msg.id === m.replyTo)
                                    ?.type === "image"
                                    ? "📷 Photo"
                                    : messages.find(
                                        (msg) => msg.id === m.replyTo
                                      )?.type === "audio"
                                    ? "🎤 Voice"
                                    : "Message")}
                              </div>
                            )}

                            {/* Message Types */}
                            {m.type === "text" && (
                              <p className="break-words">{m.text}</p>
                            )}

                            {m.type === "image" && (
                              <div className="mt-1">
                                <div className="relative group overflow-hidden rounded-lg bg-black/20 w-[240px] h-[180px] sm:w-[260px] sm:h-[195px]">
                                  <img
                                    src={m.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    className="absolute inset-0 h-full w-full object-cover cursor-pointer"
                                    onClick={() =>
                                      setLightbox({
                                        open: true,
                                        url: m.imageUrl,
                                      })
                                    }
                                    referrerPolicy="no-referrer"
                                  />
                                  <a
                                    href={m.imageUrl}
                                    download
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white px-2 py-1 rounded text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Download
                                  </a>
                                </div>
                              </div>
                            )}

                            {m.type === "audio" && (
                              <div className="mt-1">
                                <AudioBubble src={m.audioUrl} mine={mine} />
                              </div>
                            )}

                            {/* Timestamp + read receipt */}
                            <div
                              className={`flex items-center justify-end gap-1 mt-1 ${
                                mine ? "text-blue-200" : "text-gray-400"
                              }`}
                            >
                              <p className="text-[10px]">
                                {formatTime(m.createdAt)}
                              </p>
                              {mine && !isGroup && (
                                <span
                                  className={`material-symbols-outlined text-[16px] leading-none ${
                                    isReadByPeer
                                      ? mine
                                        ? "text-white"
                                        : "text-blue-400"
                                      : ""
                                  }`}
                                  title={isReadByPeer ? "Read" : "Delivered"}
                                >
                                  {isReadByPeer ? "done_all" : "done"}
                                </span>
                              )}
                            </div>

                            {/* Inline Popup Menu (sticky to this bubble) */}
                            {contextMenuMessageId === m.id && (
                              <div
                                className={`absolute -top-0 ${
                                  mine ? "-left-22" : "-right-22"
                                } bg-[#1f2b38] border border-gray-700 rounded shadow-lg z-50`}
                              >
                                <button
                                  onClick={() => handleReplyTo(m)}
                                  className="block w-full text-left px-3 py-1 hover:bg-gray-700 text-sm"
                                >
                                  Reply
                                </button>
                                <button
                                  onClick={async () => {
                                    const msgRef = doc(
                                      db,
                                      "rooms",
                                      activeRoomId,
                                      "messages",
                                      m.id
                                    );
                                    const msgSnap = await getDoc(msgRef);

                                    if (msgSnap.exists()) {
                                      const msg = msgSnap.data();

                                      // 1️⃣ If the message has media, delete from Supabase storage
                                      const mediaUrl =
                                        msg.type === "image"
                                          ? msg.imageUrl
                                          : msg.type === "audio"
                                          ? msg.audioUrl
                                          : null;
                                      if (mediaUrl) {
                                        try {
                                          console.log(
                                            "Deleting media from Supabase:",
                                            mediaUrl
                                          );
                                          await deleteMediaFiles([mediaUrl]);
                                        } catch (err) {
                                          console.error(
                                            "Failed to delete media file:",
                                            err
                                          );
                                        }
                                      }

                                      // 2️⃣ Delete the Firestore message doc
                                      await deleteDoc(msgRef);

                                      // 3️⃣ Update the room's lastMessagePreview
                                      const q = query(
                                        collection(
                                          db,
                                          "rooms",
                                          activeRoomId,
                                          "messages"
                                        ),
                                        orderBy("createdAt", "desc"),
                                        limit(1)
                                      );
                                      const snap = await getDocs(q);

                                      if (!snap.empty) {
                                        const lastMsg = snap.docs[0].data();
                                        await updateDoc(
                                          doc(db, "rooms", activeRoomId),
                                          {
                                            lastMessageAt:
                                              lastMsg.createdAt ||
                                              serverTimestamp(),
                                            lastMessagePreview:
                                              lastMsg.type === "text"
                                                ? lastMsg.text.slice(0, 80)
                                                : lastMsg.type === "image"
                                                ? "📷 Photo"
                                                : lastMsg.type === "audio"
                                                ? "🎤 Voice"
                                                : "Message",
                                          }
                                        );
                                      } else {
                                        // If no messages left in this room
                                        await updateDoc(
                                          doc(db, "rooms", activeRoomId),
                                          {
                                            lastMessageAt: serverTimestamp(),
                                            lastMessagePreview: "",
                                          }
                                        );
                                      }
                                    }

                                    setContextMenuMessageId(null);
                                  }}
                                  className="block w-full text-left px-3 py-1 text-red-400 hover:bg-gray-700 text-sm"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Scroll-to-bottom button */}
                {showScrollToBottom && (
                  <button
                    onClick={() => {
                      if (listRef.current) {
                        listRef.current.scrollTo({
                          top: listRef.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }
                    }}
                    className={`absolute right-6 bottom-10 z-30 bg-blue-400 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all duration-200 flex items-center justify-center ${
                      showScrollToBottom
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 translate-y-4 pointer-events-none"
                    }`}
                    aria-label="Scroll to bottom"
                  >
                    <span className="material-symbols-outlined text-lg">
                      arrow_downward
                    </span>
                  </button>
                )}
              </div>

              {/* Reply bar above composer (Telegram style) */}
              {replyTo && (
                <div className="flex items-center justify-between bg-[#223749]/80 backdrop-blur-md text-white px-4 py-2 border-b border-gray-600 animate-slideDown">
                  <div className="truncate max-w-[80%]">
                    <p className="text-xs text-gray-300">Replying to</p>
                    <p className="text-sm truncate">
                      {replyTo.text ||
                        (replyTo.type === "image"
                          ? "📷 Photo"
                          : replyTo.type === "audio"
                          ? "🎤 Voice"
                          : "Message")}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="text-gray-400 hover:text-white text-lg"
                  >
                    ✖
                  </button>
                </div>
              )}

              <footer
                className="flex items-center gap-2 p-2 border-t border-gray-700 bg-[#1f2b38] relative"
                style={{
                  paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
                }}
                onPointerDownCapture={keepKbFocus}
              >
                {/* Always show mic button, changes function when recording */}
                <button
                  className="p-3 rounded-full hover:bg-gray-700 flex items-center justify-center transition-all duration-200 hover:scale-110"
                  onClick={recording ? cancelRecording : toggleRecord}
                >
                  <span className="material-symbols-outlined text-xl leading-none">
                    {recording ? "close" : "mic"}
                  </span>
                </button>

                {/* Text input */}
                <input
                  ref={inputRef}
                  className="flex-1 bg-[#18222d] rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
                  placeholder="Type a message..."
                  type="text"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setShowSendButton(!!e.target.value.trim());

                    if (!isTyping && activeRoomId) {
                      startTyping(activeRoomId, me.uid);
                      setIsTyping(true);
                    }

                    if (typingTimeout.current)
                      clearTimeout(typingTimeout.current);
                    typingTimeout.current = setTimeout(() => {
                      if (activeRoomId) stopTyping(activeRoomId, me.uid);
                      setIsTyping(false);
                    }, 3000);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const toSend = text.trim();
                      setText(""); // clear immediately
                      sendMessage(toSend);

                      if (activeRoomId) stopTyping(activeRoomId, me.uid);
                      setIsTyping(false);
                      if (typingTimeout.current)
                        clearTimeout(typingTimeout.current);
                    }
                  }}
                />

                {/* Conditional rendering for send/attach buttons */}
                {showSendButton && !recording ? (
                  <button
                    className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-all duration-300 hover:scale-110"
                    onClick={() => {
                      const toSend = text.trim();
                      setText("");
                      sendMessage(toSend);
                    }}
                    disabled={sending}
                  >
                    <span className="material-symbols-outlined text-xl leading-none">
                      send
                    </span>
                  </button>
                ) : !recording ? (
                  <label
                    className="p-3 rounded-full hover:bg-gray-700 relative cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-110"
                    data-ignore-keep-kb
                    title="Attach photos"
                  >
                    <span className="material-symbols-outlined text-xl leading-none">
                      attach_file
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={handleSelectPhotos}
                    />
                  </label>
                ) : (
                  <button
                    onClick={finalizeRecording}
                    className="p-3 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center transition-all duration-300 hover:scale-110"
                    title="Send recording"
                  >
                    <span className="material-symbols-outlined text-xl leading-none">
                      send
                    </span>
                  </button>
                )}

                {/* Floating vertical recording panel with enhanced features */}
                {recording && (
                  <div className="absolute bottom-20 right-4 flex flex-col items-center gap-4 px-2 py-3 rounded-2xl bg-[#223749]/90 backdrop-blur-md shadow-2xl border border-blue-500 animate-fadeIn z-50">
                    {/* Visual indicator and timer */}
                    <div className="flex flex-col items-center gap-2">
                      {/* Recording status indicator */}
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
                          {isPaused && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-3 h-3 bg-yellow-400 rounded-sm"></div>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          {isPaused ? "Paused" : "Recording..."}
                        </p>
                      </div>

                      {/* Waveform + timer */}
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-end gap-1 h-6">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span
                              key={i}
                              className="w-1 bg-blue-400 animate-pulse"
                              style={{
                                height: `${8 + Math.random() * 16}px`,
                                animationDelay: `${i * 0.15}s`,
                              }}
                            />
                          ))}
                        </div>
                        <p className="text-sm font-mono text-gray-200">
                          {recordTimer}
                        </p>
                      </div>
                    </div>

                    {/* Control buttons */}
                    <div className="flex flex-col gap-3">
                      {/* Pause/Resume */}
                      <button
                        onClick={togglePauseRecord}
                        className="w-12 h-12 rounded-full flex items-center justify-center bg-yellow-600 hover:bg-yellow-500 shadow-lg transition transform hover:scale-110"
                      >
                        <span className="material-symbols-outlined text-white text-2xl">
                          {isPaused ? "play_arrow" : "pause"}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </footer>
            </>
          )}
        </main>
      )}

      {/* Profile View (Desktop side panel) */}
      {!isMobile && showProfile && (
        <aside className="flex-col w-80 lg:w-96 bg-[#1f2b38] border-l border-gray-700 flex-shrink-0 flex">
          <ProfileView
            profile={profileData}
            presence={presence[profileViewUid]}
            onClose={() => {
              setShowProfile(false);
            }}
            isMe={profileViewUid === me.uid}
            sharedMedia={sharedMedia}
            loadingMedia={loadingMedia}
            activeRoom={activeRoom}
            onAddMembers={() => setShowAddMembers(true)}
            onOpenImage={openLightbox}
            onPlayAudio={handlePlayAudio}
            isAdmin={!!(activeRoom?.adminIds || []).includes(me.uid)}
          />
        </aside>
      )}

      {/* MOBILE full-screen chat */}
      {showMobileChat && (
        <div
          className="fixed inset-0 z-40 bg-[#18222d] md:hidden flex flex-col"
          style={{ height: "100svh" }}
        >
          {/* Top header */}
          <header className="sticky top-0 z-10 flex items-center p-4 border-b border-gray-700 bg-[#1f2b38]">
            <button
              className="mr-2 p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
              onClick={() => setActiveRoomId(null)}
            >
              <span className="material-symbols-outlined leading-none">
                arrow_back
              </span>
            </button>
            {activeRoom?.type === "group" ? (
              <>
                <div className="relative mr-3">
                  {activeRoom.avatarUrl ? (
                    <img
                      src={activeRoom.avatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover ring-2 ring-[#1f2b38]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                      {(activeRoom.title || "G").slice(0, 1)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold truncate">
                    {activeRoom.title || "Group"}
                  </h2>
                  <p className="text-sm text-gray-400 truncate">
                    {/* ---- Group typing logic ---- */}
                    {(() => {
                      const typingIds = Object.keys(typingUsers || {}).filter(
                        (id) => id !== me.uid
                      );
                      if (typingIds.length === 1) {
                        const user = peerProfiles[typingIds[0]];
                        return `${
                          user?.displayName || user?.username || "Someone"
                        } is typing…`;
                      } else if (typingIds.length > 1) {
                        return `${typingIds.length} people typing…`;
                      } else {
                        return `${
                          activeRoom.memberIds?.length || 0
                        } members • ${
                          activeRoom.memberIds?.filter(
                            (id) => presence[id]?.state === "online"
                          ).length || 0
                        } online`;
                      }
                    })()}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="relative mr-3">
                  {peerAvatar ? (
                    <img
                      src={peerAvatar}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover ring-2 ring-[#1f2b38]"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = "/logo-swiftly.svg";
                      }}
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                      {(peer?.displayName || peer?.username || "U").slice(0, 1)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold truncate">
                    {peer?.displayName || peer?.username || "User"}
                  </h2>
                  <p className="text-sm text-gray-400 truncate">
                    {/* ---- DM typing logic ---- */}
                    {Object.keys(typingUsers || {}).some((id) => id !== me.uid)
                      ? "typing…"
                      : lastSeenText(peerPresence)}
                  </p>
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center">
                <span className="material-symbols-outlined leading-none">
                  call
                </span>
              </button>
              <button className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center">
                <span className="material-symbols-outlined leading-none">
                  search
                </span>
              </button>
              <button
                className="p-2 rounded-full hover:bg-gray-700 relative  flex items-center justify-center"
                ref={menuRef}
                onClick={(e) => {
                  e.stopPropagation(); // prevent the click from bubbling
                  setShowMenu((v) => !v);
                }}
              >
                <span className="material-symbols-outlined leading-none">
                  more_vert
                </span>

                {showMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 bg-[#1f2b38] border border-gray-700 rounded-lg shadow-lg z-50 w-48"
                    onClick={(e) => e.stopPropagation()} // prevent menu clicks from bubbling
                  >
                    <div
                      onClick={() => {
                        openProfileFromMenu();
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-sm leading-none">
                        person
                      </span>
                      {activeRoom.type === "group"
                        ? "Group Info"
                        : "View Profile"}
                    </div>

                    {activeRoom.type === "group" &&
                      activeRoom.adminIds?.includes(me.uid) && (
                        <div
                          onClick={() => {
                            setShowAddMembers(true);
                            setShowMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            group_add
                          </span>
                          Add Members
                        </div>
                      )}

                    <div
                      onClick={() => {
                        deleteChat();
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-700 text-red-400 flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-sm leading-none">
                        delete
                      </span>
                      Delete Chat
                    </div>
                  </div>
                )}
              </button>
            </div>
          </header>

          {/* Messages (only this scrolls) */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <div
              ref={listRef}
              className="h-full overflow-y-auto scrollbar-telegram p-4 lg:p-6 space-y-4 lg:space-y-6"
            >
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm pt-8">
                  No messages yet — say hello!
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.senderId === me.uid;
                  const isGroup = activeRoom?.type === "group";
                  const senderProfile = isGroup
                    ? peerProfiles[m.senderId]
                    : null;
                  const senderName =
                    senderProfile?.displayName ||
                    senderProfile?.username ||
                    "Unknown";
                  const isReadByPeer =
                    !isGroup && !!peerId && (m.readBy || []).includes(peerId);

                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        mine ? "justify-end" : "justify-start"
                      }`}
                      onTouchStart={(e) => {
                        touchStartX = e.touches[0].clientX;
                        touchStartY = e.touches[0].clientY;
                        touchMoveX = 0;
                        touchMoveY = 0;
                        gestureLocked = null; // reset gesture type

                        // Prepare long press
                        holdTimer = setTimeout(() => {
                          setDeleteConfirm({ open: true, message: m });
                        }, holdDuration);
                      }}
                      onTouchMove={(e) => {
                        clearTimeout(holdTimer);

                        touchMoveX = e.touches[0].clientX - touchStartX;
                        touchMoveY = e.touches[0].clientY - touchStartY;

                        // If gesture type not decided yet
                        if (gestureLocked === null) {
                          if (Math.abs(touchMoveY) > Math.abs(touchMoveX)) {
                            gestureLocked = "vertical"; // scrolling → ignore swipes
                          } else if (Math.abs(touchMoveX) > 10) {
                            gestureLocked = "horizontal"; // horizontal intent
                          }
                        }

                        if (gestureLocked === "vertical") {
                          return; // 🚫 ignore swipe, let scroll happen
                        }

                        if (gestureLocked === "horizontal") {
                          const maxSwipe = 60; // limit bubble travel
                          const limitedMoveX = Math.max(
                            -maxSwipe,
                            Math.min(maxSwipe, touchMoveX)
                          );
                          const bubble = document.getElementById(
                            `bubble-${m.id}`
                          );
                          if (bubble) {
                            bubble.style.transform = `translateX(${limitedMoveX}px)`;
                          }
                        }
                      }}
                      onTouchEnd={(e) => {
                        clearTimeout(holdTimer);

                        const diffX = e.changedTouches[0].clientX - touchStartX;
                        const diffY = e.changedTouches[0].clientY - touchStartY;

                        const bubble = document.getElementById(
                          `bubble-${m.id}`
                        );
                        if (bubble) {
                          bubble.style.transition = "transform 0.2s ease-out";
                          bubble.style.transform = "translateX(0)";
                          setTimeout(() => {
                            if (bubble) bubble.style.transition = "";
                          }, 200);
                        }

                        // Only trigger swipe action if gesture was horizontal
                        if (gestureLocked === "horizontal") {
                          const triggerThreshold = 40;

                          if (diffX <= -triggerThreshold) {
                            handleReplyTo(m); // left → reply
                          } else if (diffX >= triggerThreshold) {
                            setDeleteConfirm({ open: true, message: m }); // right → delete
                          }
                        }

                        // Reset gesture lock
                        gestureLocked = null;
                      }}
                    >
                      <div
                        id={`bubble-${m.id}`}
                        className={`max-w-[85%] sm:max-w-xs lg:max-w-md p-3 rounded-lg shadow-sm ${
                          mine
                            ? "bg-blue-700 text-white rounded-br-none"
                            : "bg-[#1f2b38] text-[#e0e0e0] rounded-bl-none border border-white/5"
                        }`}
                      >
                        {/* Sender name in groups */}
                        {isGroup && !mine && (
                          <div className="text-xs font-medium text-gray-400 mb-1">
                            {senderName}
                          </div>
                        )}

                        {/* Reply snippet */}
                        {m.replyTo && (
                          <div className="text-xs text-gray-400 border-l-2 border-blue-500 pl-2 mb-1">
                            {messages.find((msg) => msg.id === m.replyTo)
                              ?.text ||
                              (messages.find((msg) => msg.id === m.replyTo)
                                ?.type === "image"
                                ? "📷 Photo"
                                : messages.find((msg) => msg.id === m.replyTo)
                                    ?.type === "audio"
                                ? "🎤 Voice"
                                : "Message")}
                          </div>
                        )}

                        {/* Message content */}
                        {m.type === "text" && (
                          <p className="break-words">{m.text}</p>
                        )}

                        {m.type === "image" && (
                          <div className="mt-1">
                            <div className="relative group overflow-hidden rounded-lg bg-black/20 w-[240px] h-[180px] sm:w-[260px] sm:h-[195px]">
                              <img
                                src={m.imageUrl}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover cursor-pointer"
                                onClick={() =>
                                  setLightbox({ open: true, url: m.imageUrl })
                                }
                                referrerPolicy="no-referrer"
                              />
                              <a
                                href={m.imageUrl}
                                download
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white px-2 py-1 rounded text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Download
                              </a>
                            </div>
                          </div>
                        )}

                        {m.type === "audio" && (
                          <div className="mt-1">
                            <AudioBubble src={m.audioUrl} mine={mine} />
                          </div>
                        )}

                        {/* Footer: time + ticks */}
                        <div
                          className={`flex items-center justify-end gap-1 mt-1 ${
                            mine ? "text-blue-200" : "text-gray-400"
                          }`}
                        >
                          <p className="text-[10px]">
                            {formatTime(m.createdAt)}
                          </p>
                          {mine && !isGroup && (
                            <span
                              className={`material-symbols-outlined text-[16px] leading-none ${
                                isReadByPeer ? "text-white" : ""
                              }`}
                              title={isReadByPeer ? "Read" : "Delivered"}
                            >
                              {isReadByPeer ? "done_all" : "done"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Scroll-to-bottom button */}
            {showScrollToBottom && (
              <button
                onClick={() => {
                  if (listRef.current) {
                    listRef.current.scrollTo({
                      top: listRef.current.scrollHeight,
                      behavior: "smooth",
                    });
                  }
                }}
                className={`absolute right-6 bottom-10 z-30 bg-blue-400 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all duration-200 flex items-center justify-center ${
                  showScrollToBottom
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4 pointer-events-none"
                }`}
                aria-label="Scroll to bottom"
              >
                <span className="material-symbols-outlined text-lg">
                  arrow_downward
                </span>
              </button>
            )}
          </div>

          {/* Reply bar above composer (Telegram style) */}
          {replyTo && (
            <div className="flex items-center justify-between bg-[#223749]/80 backdrop-blur-md text-white px-4 py-2 border-b border-gray-600 animate-slideDown">
              <div className="truncate max-w-[80%]">
                <p className="text-xs text-gray-300">Replying to</p>
                <p className="text-sm truncate">
                  {replyTo.text ||
                    (replyTo.type === "image"
                      ? "📷 Photo"
                      : replyTo.type === "audio"
                      ? "🎤 Voice"
                      : "Message")}
                </p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="text-gray-400 hover:text-white text-lg"
              >
                ✖
              </button>
            </div>
          )}

          <footer
            className="flex items-center gap-2 p-2 border-t border-gray-700 bg-[#1f2b38] relative"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
            onPointerDownCapture={keepKbFocus}
          >
            {/* Always show mic button, changes function when recording */}
            <button
              data-ignore-keep-kb
              className="p-3 rounded-full hover:bg-gray-700 flex items-center justify-center transition-all duration-200 hover:scale-110"
              onClick={recording ? cancelRecording : toggleRecord}
            >
              <span className="material-symbols-outlined text-xl leading-none">
                {recording ? "close" : "mic"}
              </span>
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              className="flex-1 bg-[#18222d] rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
              placeholder="Type a message..."
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setShowSendButton(!!e.target.value.trim());

                if (!isTyping && activeRoomId) {
                  startTyping(activeRoomId, me.uid);
                  setIsTyping(true);
                }

                if (typingTimeout.current) clearTimeout(typingTimeout.current);
                typingTimeout.current = setTimeout(() => {
                  if (activeRoomId) stopTyping(activeRoomId, me.uid);
                  setIsTyping(false);
                }, 3000);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const toSend = text.trim();
                  setText(""); // clear immediately
                  sendMessage(toSend);

                  if (activeRoomId) stopTyping(activeRoomId, me.uid);
                  setIsTyping(false);
                  if (typingTimeout.current)
                    clearTimeout(typingTimeout.current);
                }
              }}
            />

            {/* Conditional rendering for send/attach buttons */}
            {showSendButton && !recording ? (
              <button
                className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-all duration-300 hover:scale-110"
                onClick={() => {
                  const toSend = text.trim();
                  setText("");
                  sendMessage(toSend);
                }}
                disabled={sending}
              >
                <span className="material-symbols-outlined text-xl leading-none">
                  send
                </span>
              </button>
            ) : !recording ? (
              <label
                className="p-3 rounded-full hover:bg-gray-700 relative cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-110"
                data-ignore-keep-kb
                title="Attach photos"
              >
                <span className="material-symbols-outlined text-xl leading-none">
                  attach_file
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleSelectPhotos}
                />
              </label>
            ) : (
              <button
                data-ignore-keep-kb
                onClick={finalizeRecording}
                className="p-3 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center transition-all duration-300 hover:scale-110"
                title="Send recording"
              >
                <span className="material-symbols-outlined text-xl leading-none">
                  send
                </span>
              </button>
            )}

            {/* Floating vertical recording panel with enhanced features */}
            {recording && (
              <div
                data-ignore-keep-kb
                className="absolute bottom-20 right-4 flex flex-col items-center gap-4 px-2 py-3 rounded-2xl bg-[#223749]/90 backdrop-blur-md shadow-2xl border border-blue-500 animate-fadeIn z-50"
              >
                {/* Visual indicator and timer */}
                <div className="flex flex-col items-center gap-2">
                  {/* Recording status indicator */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
                      {isPaused && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-3 h-3 bg-yellow-400 rounded-sm"></div>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {isPaused ? "Paused" : "Recording..."}
                    </p>
                  </div>

                  {/* Waveform + timer */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-end gap-1 h-6">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className="w-1 bg-blue-400 animate-pulse"
                          style={{
                            height: `${8 + Math.random() * 16}px`,
                            animationDelay: `${i * 0.15}s`,
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-sm font-mono text-gray-200">
                      {recordTimer}
                    </p>
                  </div>
                </div>

                {/* Control buttons */}
                <div className="flex flex-col gap-3">
                  {/* Pause/Resume */}
                  <button
                    onClick={togglePauseRecord}
                    className="w-12 h-12 rounded-full flex items-center justify-center bg-yellow-600 hover:bg-yellow-500 shadow-lg transition transform hover:scale-110"
                  >
                    <span className="material-symbols-outlined text-white text-2xl">
                      {isPaused ? "play_arrow" : "pause"}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </footer>
        </div>
      )}

      {/* Desktop drawer */}
      {!isMobile && (
        <div
          className={`fixed inset-0 z-50 transition-all duration-300 ${
            showDrawer
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setShowDrawer(false)}
        >
          <div
            className={`absolute left-0 top-0 h-full w-72 bg-[#182533] border-r border-gray-700 shadow-xl transform transition-transform duration-300 ${
              showDrawer ? "translate-x-0" : "-translate-x-full"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex items-center gap-3">
              <img src="/logo-swiftly.svg" alt="Swiftly" className="h-8 w-8" />
              <div className="font-semibold">Swiftly</div>
            </div>
            <nav className="p-3 space-y-1">
              <button
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md ${
                  view === "chats"
                    ? "bg-blue-500/20 text-white"
                    : "text-slate-300 hover:bg-slate-700/50"
                }`}
                onClick={() => {
                  setView("chats");
                  setShowDrawer(false);
                }}
              >
                <span className="material-symbols-outlined leading-none">
                  chat_bubble
                </span>
                <span>Chats</span>
              </button>
              <button
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md ${
                  view === "settings"
                    ? "bg-blue-500/20 text-white"
                    : "text-slate-300 hover:bg-slate-700/50"
                }`}
                onClick={() => {
                  setView("settings");
                  setShowDrawer(false);
                }}
              >
                <span className="material-symbols-outlined leading-none">
                  settings
                </span>
                <span>Settings</span>
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Add Members Modal (backdrop no-close) */}
      {showAddMembers && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#1f2b38] border border-gray-700 rounded-2xl shadow-xl p-4 max-h-[90vh] overflow-y-auto scrollbar-telegram">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Add Members to Group</h2>
              <button
                className="p-1 rounded hover:bg-gray-700 flex items-center justify-center"
                onClick={() => setShowAddMembers(false)}
                disabled={addingMembers}
              >
                <span className="material-symbols-outlined leading-none">
                  close
                </span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">
                    Add Members ({groupAddMembers.length})
                  </label>
                </div>

                <div className="mb-2">
                  <input
                    type="text"
                    value={groupSearchTerm}
                    onChange={(e) => setGroupSearchTerm(e.target.value)}
                    placeholder="Search users to add..."
                    className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    disabled={addingMembers}
                  />
                </div>

                <div className="bg-[#18222d] rounded-md border border-gray-700 p-2 max-h-40 overflow-y-auto">
                  {searching ? (
                    <div className="text-center text-gray-400 py-4">
                      Searching...
                    </div>
                  ) : results.length > 0 ? (
                    <ul className="space-y-1">
                      {results.map((p) => {
                        const isSelected = groupAddMembers.some(
                          (m) => m.id === p.id
                        );
                        const isAlreadyMember = activeRoom?.memberIds?.includes(
                          p.id
                        );
                        const isOnline = presence[p.id]?.state === "online";
                        const avatar = normalizeGooglePhotoURL(
                          p.photoURL || "",
                          32
                        );
                        const title = p.displayName || p.username || "User";
                        return (
                          <li
                            key={p.id}
                            className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                              isSelected
                                ? "bg-blue-500/20"
                                : "hover:bg-gray-700/50"
                            } ${
                              isAlreadyMember
                                ? "opacity-50 cursor-not-allowed"
                                : ""
                            }`}
                            onClick={() =>
                              !isAlreadyMember && toggleGroupMember(p, true)
                            }
                            title={isAlreadyMember ? "Already in group" : ""}
                          >
                            <div className="relative">
                              {avatar ? (
                                <img
                                  src={avatar}
                                  alt={title}
                                  className="h-8 w-8 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-gray-700 grid place-items-center text-xs font-semibold">
                                  {title.slice(0, 1)}
                                </div>
                              )}
                              {isOnline && (
                                <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1f2b38]" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">{title}</div>
                              <div className="text-xs text-gray-400 truncate">
                                @{p.username || p.id.slice(0, 6)}
                              </div>
                            </div>
                            {isSelected && (
                              <span className="material-symbols-outlined text-blue-400 text-sm">
                                check
                              </span>
                            )}
                            {isAlreadyMember && (
                              <span className="text-xs text-gray-400">
                                Member
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="text-center text-gray-400 py-4">
                      {groupSearchTerm.trim().length >= 2
                        ? "No users found"
                        : "Search for users to add to the group"}
                    </div>
                  )}
                </div>

                {friends.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium mb-2">Your Friends</h3>
                    <div className="bg-[#18222d] rounded-md border border-gray-700 p-2 max-h-40 overflow-y-auto">
                      <ul className="space-y-1">
                        {friends.map((p) => {
                          const isSelected = groupAddMembers.some(
                            (m) => m.id === p.id
                          );
                          const isAlreadyMember =
                            activeRoom?.memberIds?.includes(p.id);
                          const isOnline = presence[p.id]?.state === "online";
                          const avatar = normalizeGooglePhotoURL(
                            p.photoURL || "",
                            32
                          );
                          const title = p.displayName || p.username || "User";
                          return (
                            <li
                              key={p.id}
                              className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                                isSelected
                                  ? "bg-blue-500/20"
                                  : "hover:bg-gray-700/50"
                              } ${
                                isAlreadyMember
                                  ? "opacity-50 cursor-not-allowed"
                                  : ""
                              }`}
                              onClick={() =>
                                !isAlreadyMember && toggleGroupMember(p, true)
                              }
                              title={isAlreadyMember ? "Already in group" : ""}
                            >
                              <div className="relative">
                                {avatar ? (
                                  <img
                                    src={avatar}
                                    alt={title}
                                    className="h-8 w-8 rounded-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-gray-700 grid place-items-center text-xs font-semibold">
                                    {title.slice(0, 1)}
                                  </div>
                                )}
                                {isOnline && (
                                  <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1f2b38]" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{title}</div>
                                <div className="text-xs text-gray-400 truncate">
                                  @{p.username || p.id.slice(0, 6)}
                                </div>
                              </div>
                              {isSelected && (
                                <span className="material-symbols-outlined text-blue-400 text-sm">
                                  check
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={addMembersToGroup}
                disabled={groupAddMembers.length === 0 || addingMembers}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingMembers
                  ? "Adding..."
                  : `Add ${groupAddMembers.length} Member${
                      groupAddMembers.length !== 1 ? "s" : ""
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal (backdrop no-close) */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#1f2b38] border border-gray-700 rounded-2xl shadow-xl p-4 max-h-[90vh] overflow-y-auto scrollbar-telegram">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Create Group</h2>
              <button
                className="p-1 rounded hover:bg-gray-700 flex items-center justify-center"
                onClick={() => setShowCreateGroup(false)}
                disabled={creatingGroup}
              >
                <span className="material-symbols-outlined leading-none">
                  close
                </span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-center">
                <label className="relative cursor-pointer">
                  {groupAvatarPreview ? (
                    <img
                      src={groupAvatarPreview}
                      alt="Group preview"
                      className="h-24 w-24 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-full bg-gray-700 flex items-center justify-center">
                      <span className="material-symbols-outlined text-3xl">
                        group
                      </span>
                    </div>
                  )}
                  <div className="absolute bottom-0 right-0 bg-blue-500 rounded-full p-1 flex items-center justify-center ">
                    <span className="material-symbols-outlined text-white text-sm">
                      edit
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleGroupAvatar}
                    disabled={creatingGroup}
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Group Name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name"
                  className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creatingGroup}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Enter group description"
                  rows={2}
                  className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  disabled={creatingGroup}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">
                    Add Members ({groupMembers.length}/99)
                  </label>
                  <span className="text-xs text-gray-400">
                    {
                      groupMembers.filter(
                        (m) => presence[m.id]?.state === "online"
                      ).length
                    }{" "}
                    online
                  </span>
                </div>

                <div className="mb-2">
                  <input
                    type="text"
                    value={groupSearchTerm}
                    onChange={(e) => setGroupSearchTerm(e.target.value)}
                    placeholder="Search users to add..."
                    className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    disabled={creatingGroup}
                  />
                </div>

                <div className="bg-[#18222d] rounded-md border border-gray-700 p-2 max-h-40 overflow-y-auto">
                  {searching ? (
                    <div className="text-center text-gray-400 py-4">
                      Searching...
                    </div>
                  ) : results.length > 0 ? (
                    <ul className="space-y-1">
                      {results.map((p) => {
                        const isSelected = groupMembers.some(
                          (m) => m.id === p.id
                        );
                        const isOnline = presence[p.id]?.state === "online";
                        const avatar = normalizeGooglePhotoURL(
                          p.photoURL || "",
                          32
                        );
                        const title = p.displayName || p.username || "User";
                        return (
                          <li
                            key={p.id}
                            className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                              isSelected
                                ? "bg-blue-500/20"
                                : "hover:bg-gray-700/50"
                            }`}
                            onClick={() => toggleGroupMember(p)}
                          >
                            <div className="relative">
                              {avatar ? (
                                <img
                                  src={avatar}
                                  alt={title}
                                  className="h-8 w-8 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-gray-700 grid place-items-center text-xs font-semibold">
                                  {title.slice(0, 1)}
                                </div>
                              )}
                              {isOnline && (
                                <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1f2b38]" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">{title}</div>
                              <div className="text-xs text-gray-400 truncate">
                                @{p.username || p.id.slice(0, 6)}
                              </div>
                            </div>
                            {isSelected && (
                              <span className="material-symbols-outlined text-blue-400 text-sm">
                                check
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="text-center text-gray-400 py-4">
                      {groupSearchTerm.trim().length >= 2
                        ? "No users found"
                        : "Search for users to add to the group"}
                    </div>
                  )}
                </div>

                {friends.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium mb-2">Your Friends</h3>
                    <div className="bg-[#18222d] rounded-md border border-gray-700 p-2 max-h-40 overflow-y-auto">
                      <ul className="space-y-1">
                        {friends.map((p) => {
                          const isSelected = groupMembers.some(
                            (m) => m.id === p.id
                          );
                          const isOnline = presence[p.id]?.state === "online";
                          const avatar = normalizeGooglePhotoURL(
                            p.photoURL || "",
                            32
                          );
                          const title = p.displayName || p.username || "User";
                          return (
                            <li
                              key={p.id}
                              className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                                isSelected
                                  ? "bg-blue-500/20"
                                  : "hover:bg-gray-700/50"
                              }`}
                              onClick={() => toggleGroupMember(p)}
                            >
                              <div className="relative">
                                {avatar ? (
                                  <img
                                    src={avatar}
                                    alt={title}
                                    className="h-8 w-8 rounded-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded-full bg-gray-700 grid place-items-center text-xs font-semibold">
                                    {title.slice(0, 1)}
                                  </div>
                                )}
                                {isOnline && (
                                  <div className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1f2b38]" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{title}</div>
                                <div className="text-xs text-gray-400 truncate">
                                  @{p.username || p.id.slice(0, 6)}
                                </div>
                              </div>
                              {isSelected && (
                                <span className="material-symbols-outlined text-blue-400 text-sm">
                                  check
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={createGroup}
                disabled={
                  !groupName.trim() ||
                  groupMembers.length === 0 ||
                  creatingGroup
                }
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingGroup
                  ? "Creating..."
                  : `Create Group (${groupMembers.length + 1}/100)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search overlay (backdrop no-close) */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4">
          <div className="w-full max-w-xl bg-[#1f2b38] border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-gray-700 flex items-center gap-3">
              <span className="material-symbols-outlined text-gray-400 leading-none">
                search
              </span>
              <input
                autoFocus
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="Search by username…"
                className="flex-1 bg-transparent outline-none text-sm text-[#e0e0e0]"
              />
              <button
                onClick={() => {
                  setShowCreateGroup(true);
                  setShowSearch(false);
                }}
                className="p-1 rounded hover:bg-gray-700 flex items-center justify-center"
                title="Create Group"
              >
                <span className="material-symbols-outlined leading-none">
                  group_add
                </span>
              </button>
              <button
                onClick={() => setShowSearch(false)}
                className="p-1 rounded hover:bg-gray-700 flex items-center justify-center"
              >
                <span className="material-symbols-outlined leading-none">
                  close
                </span>
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {searching ? (
                <div className="p-4 text-sm text-gray-400">Searching…</div>
              ) : results.length === 0 && queryText.trim().length >= 2 ? (
                <div className="p-4 text-sm text-gray-400">
                  No users found for "{queryText}".
                </div>
              ) : (
                <ul className="divide-y divide-gray-700">
                  {results.map((p) => {
                    const avatar = normalizeGooglePhotoURL(
                      p.photoURL || "",
                      40
                    );
                    const title = p.displayName || p.username || "User";
                    return (
                      <li
                        key={p.id}
                        className="flex items-center gap-3 p-3 hover:bg-gray-700/40 cursor-pointer"
                        onClick={() => startDmWith(p.id)}
                      >
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={title}
                            className="h-10 w-10 rounded-full object-cover ring-2 ring-[#1f2b38]"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = "/logo-swiftly.svg";
                            }}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#1f2b38]">
                            {title.slice(0, 1)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{title}</div>
                          <div className="text-xs text-gray-400">
                            @{p.username || p.id.slice(0, 6)}
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-gray-400 leading-none">
                          chevron_right
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {results.length === 0 && queryText.trim().length < 2 && (
                <div className="p-4 text-sm text-gray-400">
                  Type at least 2 characters to search by username.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#1f2b38] border border-gray-700 rounded-2xl shadow-xl p-6 animate-in fade-in-90 zoom-in-90">
            <div className="text-center mb-6">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-500/20 mb-4">
                <span className="material-symbols-outlined text-red-400 text-3xl">
                  delete_forever
                </span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Delete Chat
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Are you sure you want to delete this chat? This action cannot be
                undone and all messages will be permanently removed from both
                the chat and storage.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-3 px-4 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700/60 text-white font-medium transition-all duration-200 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 py-3 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-600/60 text-white font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">
                      delete_forever
                    </span>
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox (backdrop no-close) */}
      {lightbox.open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={lightbox.url}
              alt=""
              className="max-w-full max-h-[90vh] rounded-lg"
            />

            <div className="absolute top-2 right-2 flex gap-2">
              {/* Download Button */}
              <button
                className="px-3 py-1.5 rounded-md bg-white/10 text-white text-sm hover:bg-white/20"
                onClick={async () => {
                  try {
                    const res = await fetch(lightbox.url);
                    const blob = await res.blob();
                    const link = document.createElement("a");
                    link.href = window.URL.createObjectURL(blob);
                    link.download = "image.png"; // you can customize file name
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  } catch (err) {
                    console.error("Download failed", err);
                  }
                }}
              >
                Download
              </button>

              {/* Close Button */}
              <button
                className="px-3 py-1.5 rounded-md bg-white/10 text-white text-sm hover:bg-white/20"
                onClick={() => setLightbox({ open: false, url: "" })}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Audio Player */}
      {currentAudio && (
        <div
          className="fixed z-50 bg-[#1f2b38] border border-gray-700 rounded-lg shadow-xl p-4 w-80"
          style={{
            top: audioPlayerPosition.y,
            left: audioPlayerPosition.x,
            cursor: "move",
          }}
          onMouseDown={handleAudioPlayerDragStart}
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-white">Now Playing</h4>
            <button
              onClick={() => setCurrentAudio(null)}
              className="text-gray-400 hover:text-white"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={toggleAudioPlayback}
              className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
            >
              <span className="material-symbols-outlined">
                {isAudioPlaying ? "pause" : "play_arrow"}
              </span>
            </button>

            <div className="flex-1">
              <div
                className="h-2 bg-gray-700 rounded-full cursor-pointer"
                onClick={handleAudioSeek}
              >
                <div
                  className="h-2 bg-blue-500 rounded-full"
                  style={{
                    width: `${(audioCurrentTime / audioDuration) * 100}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{formatTimeMMSS(audioCurrentTime)}</span>
                <span>{formatTimeMMSS(audioDuration)}</span>
              </div>
            </div>
          </div>

          <audio
            ref={audioRef}
            src={currentAudio.audioUrl}
            onTimeUpdate={handleAudioTimeUpdate}
            onLoadedMetadata={handleAudioLoaded}
            onEnded={handleAudioEnded}
          />
        </div>
      )}

      {deleteConfirm.open && deleteConfirm.message && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#1f2b38] rounded-xl shadow-2xl w-full max-w-sm border border-gray-700 animate-fadeIn">
            <div className="p-6 text-center">
              <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-500/20 mb-4">
                <span className="material-symbols-outlined text-red-400 text-3xl">
                  delete
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Delete Message
              </h3>
              <p className="text-sm text-gray-300 mb-6">
                Are you sure you want to delete this message for everyone?
              </p>
              <div className="flex gap-3 justify-center">
                {/* Cancel */}
                <button
                  onClick={() =>
                    setDeleteConfirm({ open: false, message: null })
                  }
                  className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200"
                >
                  Cancel
                </button>

                {/* Confirm Delete */}
                <button
                  onClick={async () => {
                    const msg = deleteConfirm.message;

                    // 1️⃣ If this is media → delete from Supabase storage
                    const mediaUrl =
                      msg.type === "image"
                        ? msg.imageUrl
                        : msg.type === "audio"
                        ? msg.audioUrl
                        : null;

                    if (mediaUrl) {
                      try {
                        await deleteMediaFiles([mediaUrl]); // 👈 use your helper
                        console.log("Deleted media file:", mediaUrl);
                      } catch (err) {
                        console.error(
                          "Failed to delete media from Supabase:",
                          err
                        );
                      }
                    }

                    // 2️⃣ Delete Firestore message doc
                    await deleteDoc(
                      doc(db, "rooms", activeRoomId, "messages", msg.id)
                    );

                    // 3️⃣ Update last preview in room doc
                    const q = query(
                      collection(db, "rooms", activeRoomId, "messages"),
                      orderBy("createdAt", "desc"),
                      limit(1)
                    );
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                      const lastMsg = snap.docs[0].data();
                      await updateDoc(doc(db, "rooms", activeRoomId), {
                        lastMessageAt: lastMsg.createdAt || serverTimestamp(),
                        lastMessagePreview:
                          lastMsg.type === "text"
                            ? lastMsg.text.slice(0, 80)
                            : lastMsg.type === "image"
                            ? "📷 Photo"
                            : lastMsg.type === "audio"
                            ? "🎤 Voice"
                            : "Message",
                      });
                    } else {
                      // no messages left
                      await updateDoc(doc(db, "rooms", activeRoomId), {
                        lastMessageAt: serverTimestamp(),
                        lastMessagePreview: "",
                      });
                    }

                    setDeleteConfirm({ open: false, message: null });
                  }}
                  className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attach (backdrop no-close) */}
      {attachModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#1f2b38] border border-gray-700 rounded-2xl shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Send photos</div>
              <button
                className="p-1 rounded hover:bg-gray-700 flex items-center justify-center"
                onClick={() => setAttachModal(false)}
              >
                <span className="material-symbols-outlined leading-none">
                  close
                </span>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
              {attachFiles.map((f, i) => (
                <div key={i} className="relative">
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    className="w-full h-32 object-cover rounded-lg"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600"
                onClick={() => setAttachModal(false)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                onClick={sendAttachedPhotos}
                disabled={uploading || !attachFiles.length}
              >
                {uploading ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Profile View Component ----------
function ProfileView({
  profile,
  presence,
  onClose,
  onBack,
  isMe = false,
  sharedMedia = [],
  loadingMedia = false,
  activeRoom,
  onAddMembers,
  onOpenImage,
  onPlayAudio, // Add this prop
  isAdmin = false,
}) {
  const avatar = normalizeGooglePhotoURL(profile?.photoURL || "", 96);
  const title = profile?.displayName || profile?.username || "User";
  const username = profile?.username || "";
  const phone = profile?.phoneNumber || "";
  const isOnline = presence?.state === "online";
  const lastSeen = lastSeenText(presence);
  const isGroup = activeRoom?.type === "group";

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-gray-700 bg-[#1f2b38] flex-shrink-0">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
            >
              <span className="material-symbols-outlined leading-none">
                arrow_back
              </span>
            </button>
          )}
          <h2 className="text-lg font-semibold">
            {isGroup ? "Group Info" : "Profile"}
          </h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
          >
            <span className="material-symbols-outlined leading-none">
              close
            </span>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-telegram p-6">
        {isGroup ? (
          <GroupProfileView
            room={activeRoom}
            onAddMembers={onAddMembers}
            isAdmin={isAdmin}
          />
        ) : (
          <UserProfileView
            profile={profile}
            presence={presence}
            isMe={isMe}
            sharedMedia={sharedMedia}
            loadingMedia={loadingMedia}
            title={title}
            avatar={avatar}
            username={username}
            phone={phone}
            isOnline={isOnline}
            lastSeen={lastSeen}
            onOpenImage={onOpenImage}
            onPlayAudio={onPlayAudio}
          />
        )}
      </div>
    </div>
  );
}

// ---------- User Profile View ----------
function UserProfileView({
  profile,
  isMe,
  sharedMedia,
  loadingMedia,
  title,
  avatar,
  username,
  phone,
  isOnline,
  lastSeen,
  onOpenImage,
  onPlayAudio,
}) {
  return (
    <>
      <div className="flex flex-col items-center ">
        {avatar ? (
          <img
            src={avatar}
            alt={title}
            className="h-24 w-24 rounded-full object-cover ring-4 ring-[#1f2b38]"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.src = "/logo-swiftly.svg";
            }}
          />
        ) : (
          <div className="h-24 w-24 rounded-full bg-gray-700 grid place-items-center font-semibold text-2xl ring-4 ring-[#1f2b38]">
            {title.slice(0, 1)}
          </div>
        )}
        <h3 className="text-xl font-bold mt-4">{title}</h3>
        <p
          className={`text-sm ${
            isOnline ? "text-emerald-400" : "text-gray-400"
          }`}
        >
          {isOnline ? "Online" : lastSeen}
        </p>
      </div>

      <div className="mt-8 space-y-6">
        <section>
          <h4 className="text-sm text-gray-400 font-medium mb-3">Info</h4>
          <div className="bg-[#182533] p-4 rounded-lg space-y-4 border border-gray-700">
            {phone && (
              <div className="flex items-center gap-4">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    call
                  </span>
                </div>
                <div>
                  <p className="text-base">{phone}</p>
                  <p className="text-xs text-gray-500">Mobile</p>
                </div>
              </div>
            )}
            {username && (
              <div className="flex items-center gap-4">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    alternate_email
                  </span>
                </div>
                <div>
                  <p className="text-base">@{username}</p>
                  <p className="text-xs text-gray-500">Username</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h4 className="text-sm text-gray-400 font-medium mb-3">
            Shared Media
          </h4>
          <div className="bg-[#182533] p-4 rounded-lg border border-gray-700">
            {loadingMedia ? (
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="aspect-square bg-gray-700 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : sharedMedia.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {sharedMedia.slice(0, 9).map((m) => (
                  <div
                    key={m.id}
                    className="aspect-square bg-gray-700 rounded-lg overflow-hidden group relative"
                  >
                    {m.type === "image" ? (
                      <img
                        src={m.imageUrl}
                        alt="Shared"
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => onOpenImage?.(m.imageUrl)}
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center bg-blue-600 cursor-pointer"
                        onClick={() => onPlayAudio?.(m)}
                      >
                        <span className="material-symbols-outlined text-white">
                          audiotrack
                        </span>
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="material-symbols-outlined text-white text-2xl">
                            play_arrow
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-4">
                No shared media yet
              </div>
            )}
          </div>
        </section>

        {!isMe && (
          <section>
            <h4 className="text-sm text-gray-400 font-medium mb-3">Actions</h4>
            <div className="bg-[#182533] rounded-lg divide-y divide-slate-700 border border-gray-700">
              <button className="w-full text-left px-4 py-3 hover:bg-gray-700/50 flex items-center gap-3">
                <span className="material-symbols-outlined text-red-400">
                  block
                </span>
                <span className="text-red-400">Block User</span>
              </button>
              <button className="w-full text-left px-4 py-3 hover:bg-gray-700/50 flex items-center gap-3">
                <span className="material-symbols-outlined text-red-400">
                  report
                </span>
                <span className="text-red-400">Report User</span>
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ---------- Group Profile View with edit (admins only) ----------
export function GroupProfileView({ room, onAddMembers, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(room?.title || "");
  const [description, setDescription] = useState(room?.description || "");
  const [uploading, setUploading] = useState(false);

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    setTitle(room?.title || "");
    setDescription(room?.description || "");
  }, [room?.title, room?.description]);

  const avatar = normalizeGooglePhotoURL(room?.avatarUrl || "", 96);

  async function handleSave() {
    try {
      setUploading(true);
      await updateDoc(doc(db, "rooms", room.id), {
        title: title.trim(),
        description: description.trim(),
      });
      setEditing(false);
    } catch (e) {
      console.error("Update group error", e);
      alert("Failed to update group");
    } finally {
      setUploading(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image");
      return;
    }
    try {
      setUploading(true);
      const url = await uploadAvatar(file, room.id);
      await updateDoc(doc(db, "rooms", room.id), { avatarUrl: url });
    } catch (e) {
      console.error("Update avatar error", e);
      alert("Failed to update avatar");
    } finally {
      setUploading(false);
    }
  }

  // --- Fetch member profiles ---
  useEffect(() => {
    async function loadMembers() {
      if (!room?.memberIds?.length) {
        setMembers([]);
        setLoadingMembers(false);
        return;
      }
      try {
        setLoadingMembers(true);
        const docs = await Promise.all(
          room.memberIds.map((uid) => getDoc(doc(db, "profiles", uid)))
        );
        setMembers(
          docs
            .filter((snap) => snap.exists())
            .map((snap) => ({ id: snap.id, ...snap.data() }))
        );
      } catch (err) {
        console.error("Failed to load group members:", err);
      } finally {
        setLoadingMembers(false);
      }
    }
    loadMembers();
  }, [room?.memberIds]);

  return (
    <>
      <div className="flex flex-col items-center">
        <label
          className={`relative ${
            isAdmin ? "cursor-pointer" : "cursor-default"
          }`}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={title}
              className="h-24 w-24 rounded-full object-cover ring-4 ring-[#1f2b38]"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = "/logo-swiftly.svg";
              }}
            />
          ) : (
            <div className="h-24 w-24 rounded-full bg-gray-700 grid place-items-center font-semibold text-2xl ring-4 ring-[#1f2b38]">
              {(room?.title || "G").slice(0, 1)}
            </div>
          )}
          {isAdmin && (
            <>
              <div className="absolute bottom-0 right-0 bg-blue-600 rounded-full p-1 text-white flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">edit</span>
              </div>
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 opacity-0"
                onChange={handleAvatarChange}
                disabled={uploading}
              />
            </>
          )}
        </label>

        {!editing ? (
          <>
            <h3 className="text-xl font-bold mt-4">{room?.title || "Group"}</h3>
            <p className="text-sm text-gray-400">
              {room?.memberIds?.length || 0} members
            </p>
            {room?.description && (
              <p className="text-sm text-gray-300 mt-2 text-center">
                {room.description}
              </p>
            )}
            {isAdmin && (
              <button
                className="mt-3 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
                onClick={() => setEditing(true)}
              >
                Edit Group
              </button>
            )}
          </>
        ) : (
          <div className="w-full max-w-sm mt-4 space-y-3">
            <div>
              <label className="block text-sm mb-1">Group Name</label>
              <input
                className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Description</label>
              <textarea
                className="w-full bg-[#18222d] rounded-md px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600"
                onClick={() => setEditing(false)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                onClick={handleSave}
                disabled={uploading || !title.trim()}
              >
                {uploading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 space-y-6">
        {/* ---- Members Section ---- */}
        <section>
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm text-gray-400 font-medium">
              Members ({room?.memberIds?.length || 0})
            </h4>
            {isAdmin && (
              <button
                onClick={onAddMembers}
                className="text-blue-400 text-sm flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">
                  group_add
                </span>
                Add members
              </button>
            )}
          </div>
          <div className="bg-[#182533] p-4 rounded-lg border border-gray-700 max-h-64 overflow-y-auto">
            {loadingMembers ? (
              <p className="text-center text-gray-400 py-4">Loading members…</p>
            ) : members.length === 0 ? (
              <p className="text-center text-gray-400 py-4">No members found</p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {members.map((m) => {
                  const avatar = normalizeGooglePhotoURL(m.photoURL || "", 32);
                  const name = m.displayName || m.username || "User";
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={name}
                          className="h-8 w-8 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) =>
                            (e.currentTarget.src = "/logo-swiftly.svg")
                          }
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-gray-600 grid place-items-center text-xs font-semibold">
                          {name[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-white">{name}</p>
                        <p className="text-xs text-gray-400 truncate">
                          @{m.username || m.id.slice(0, 6)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ---- Settings Section ---- */}
        <section>
          <h4 className="text-sm text-gray-400 font-medium mb-3">
            Group Settings
          </h4>
          <div className="bg-[#182533] rounded-lg divide-y divide-slate-700 border border-gray-700">
            <div className="flex items-center justify-between px-4 py-3">
              <span>Mute notifications</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input className="sr-only peer" type="checkbox" />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <button className="w-full text-left px-4 py-3 hover:bg-gray-700/50 flex items-center gap-3">
              <span className="material-symbols-outlined text-red-400">
                exit_to_app
              </span>
              <span className="text-red-400">Leave Group</span>
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

// ---------- Mobile Settings ----------
function MobileSettingsView({ meProfile, onBack, onLogout }) {
  const avatar = normalizeGooglePhotoURL(meProfile?.photoURL || "", 48);
  return (
    <div className="p-4 ">
      <div className="flex items-center gap-3 mb-6 ">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-gray-700 flex items-center justify-center"
        >
          <span className="material-symbols-outlined leading-none">
            arrow_back
          </span>
        </button>
        <h1 className="text-white text-xl font-bold">Settings</h1>
      </div>
      <div className="space-y-6">
        <section>
          <h2 className="text-white text-lg font-bold mb-3">Account</h2>
          <div className="bg-[#182533] p-4 rounded-lg space-y-4 border border-gray-700">
            <div className="flex items-center gap-4">
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover ring-2 ring-[#182533]"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#182533]">
                  {(meProfile?.displayName || meProfile?.username || "U").slice(
                    0,
                    1
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-lg font-medium truncate">
                  {meProfile?.displayName || "You"}
                </p>
                <p className="text-slate-400 text-sm truncate">
                  @{meProfile?.username || "username"}
                </p>
              </div>
              <button className="text-slate-400 hover:text-white p-2 rounded hover:bg-gray-700 flex items-center justify-center">
                <span className="material-symbols-outlined leading-none">
                  edit
                </span>
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white text-lg font-bold mb-3">
            Notifications and Sounds
          </h2>
          <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
            {[
              { icon: "notifications", label: "Notifications", enabled: true },
              { icon: "volume_up", label: "In‑App Sounds", enabled: false },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    {row.icon}
                  </span>
                </div>
                <p className="text-white flex-1">{row.label}</p>
                <label
                  className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full border-none transition-colors ${
                    row.enabled ? "bg-[var(--primary-color)]" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute h-5 w-5 rounded-full bg-white transition-transform duration-300 ease-in-out transform ${
                      row.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-white text-lg font-bold mb-3">
            Privacy and Security
          </h2>
          <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
            {[
              {
                icon: "visibility",
                label: "Last Seen & Online",
                value: "Everyone",
              },
              {
                icon: "account_circle",
                label: "Profile Photo",
                value: "Everyone",
              },
              {
                icon: "groups",
                label: "Groups & Channels",
                value: "My Contacts",
              },
              { icon: "devices", label: "Active Sessions", value: "1" },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    {row.icon}
                  </span>
                </div>
                <p className="text-white flex-1">{row.label}</p>
                <p className="text-slate-400 truncate">{row.value}</p>
                <span className="material-symbols-outlined text-slate-400 leading-none">
                  chevron_right
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-white text-lg font-bold mb-3">
            Data and Storage
          </h2>
          <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
            <div className="flex items-center gap-4 py-3">
              <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-white leading-none">
                  inventory_2
                </span>
              </div>
              <p className="text-white flex-1">Storage Usage</p>
              <p className="text-slate-400">—</p>
              <span className="material-symbols-outlined text-slate-400 leading-none">
                chevron_right
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white text-lg font-bold mb-3">Language</h2>
          <div className="bg-[#182533] p-4 rounded-lg border border-gray-700">
            <div className="flex items-center gap-4">
              <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-white leading-none">
                  translate
                </span>
              </div>
              <p className="text-white flex-1">Language</p>
              <p className="text-slate-400">English</p>
              <span className="material-symbols-outlined text-slate-400 leading-none">
                chevron_right
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white text-lg font-bold mb-3">Other</h2>
          <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
            <div className="flex items-center gap-4 py-3">
              <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-white leading-none">
                  help_outline
                </span>
              </div>
              <p className="text-white flex-1">Ask a Question</p>
              <span className="material-symbols-outlined text-slate-400 leading-none">
                chevron_right
              </span>
            </div>
            <div className="flex items-center gap-4 py-3">
              <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-white leading-none">
                  quiz
                </span>
              </div>
              <p className="text-white flex-1">Swiftly FAQ</p>
              <span className="material-symbols-outlined text-slate-400 leading-none">
                chevron_right
              </span>
            </div>
            <div className="flex items-center gap-4 py-3">
              <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-white leading-none">
                  privacy_tip
                </span>
              </div>
              <p className="text-white flex-1">Swiftly Privacy Policy</p>
              <span className="material-symbols-outlined text-slate-400 leading-none">
                chevron_right
              </span>
            </div>
            <button
              className="w-full mt-2 px-3 py-2 cursor-pointer rounded-md bg-red-600/20 hover:bg-red-600/30 text-red-300 flex items-center gap-2"
              onClick={onLogout}
              type="button"
            >
              <span className="material-symbols-outlined">logout</span>
              Log Out
            </button>
          </div>
        </section>

        <div className="text-center mt-8 pt-6 border-t border-gray-700/20">
          <div className="inline-flex flex-col items-center">
            <p className="text-xs text-gray-500 mb-1 tracking-wider">
              TECHNOLOGY PARTNER
            </p>
            <p className="text-sm font-medium text-gray-300 tracking-tight">
              Refora Technologies
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Desktop Settings ----------
function SettingsView({ meProfile, onClose, onLogout }) {
  const avatar = normalizeGooglePhotoURL(meProfile?.photoURL || "", 48);
  return (
    <div className="flex-1 p-4 sm:p-8 overflow-y-auto scrollbar-telegram min-h-0">
      <header className="flex items-center justify-between mb-6 md:hidden">
        <h1 className="text-white 2xl:text-2xl text-2xl font-bold">Settings</h1>
        <button
          className="text-white p-2 rounded hover:bg-gray-700"
          onClick={onClose}
        >
          <span className="material-symbols-outlined leading-none">close</span>
        </button>
      </header>
      <h1 className="text-white text-4xl font-bold mb-6 hidden md:block">
        Settings
      </h1>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="col-span-1 xl:col-span-2 space-y-8">
          <section>
            <h2 className="text-white text-lg font-bold mb-4">Account</h2>
            <div className="bg-[#182533] p-4 rounded-lg space-y-4 border border-gray-700">
              <div className="flex items-center gap-4">
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-[#182533]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gray-700 grid place-items-center font-semibold ring-2 ring-[#182533]">
                    {(
                      meProfile?.displayName ||
                      meProfile?.username ||
                      "U"
                    ).slice(0, 1)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-lg font-medium truncate">
                    {meProfile?.displayName || "You"}
                  </p>
                  <p className="text-slate-400 text-sm truncate">
                    @{meProfile?.username || "username"}
                  </p>
                </div>
                <button className="text-slate-400 hover:text-white p-2 rounded hover:bg-gray-700 flex items-center justify-center">
                  <span className="material-symbols-outlined leading-none">
                    edit
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-lg font-bold mb-4">
              Notifications and Sounds
            </h2>
            <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
              {[
                {
                  icon: "notifications",
                  label: "Notifications",
                  enabled: true,
                },
                { icon: "volume_up", label: "In‑App Sounds", enabled: false },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-4 py-3">
                  <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-white leading-none">
                      {row.icon}
                    </span>
                  </div>
                  <p className="text-white flex-1">{row.label}</p>
                  <label
                    className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full border-none transition-colors ${
                      row.enabled ? "bg-[var(--primary-color)]" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`absolute h-5 w-5 rounded-full bg-white transition-transform duration-300 ease-in-out transform ${
                        row.enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-span-1 space-y-8">
          <section>
            <h2 className="text-white text-lg font-bold mb-4">Other</h2>
            <div className="bg-[#182533] p-4 rounded-lg divide-y divide-slate-700 border border-gray-700">
              <div className="flex items-center gap-4 py-3">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    help_outline
                  </span>
                </div>
                <p className="text-white flex-1">Ask a Question</p>
                <span className="material-symbols-outlined text-slate-400 leading-none">
                  chevron_right
                </span>
              </div>
              <div className="flex items-center gap-4 py-3">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    quiz
                  </span>
                </div>
                <p className="text-white flex-1">Swiftly FAQ</p>
                <span className="material-symbols-outlined text-slate-400 leading-none">
                  chevron_right
                </span>
              </div>
              <div className="flex items-center gap-4 py-3">
                <div className="bg-slate-700 rounded-lg h-10 w-10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white leading-none">
                    privacy_tip
                  </span>
                </div>
                <p className="text-white flex-1">Swiftly Privacy Policy</p>
                <span className="material-symbols-outlined text-slate-400 leading-none">
                  chevron_right
                </span>
              </div>
              <button
                className="w-full mt-2 px-3 py-2 cursor-pointer rounded-md bg-red-600/20 hover:bg-red-600/30 text-red-300 flex items-center gap-2"
                onClick={onLogout}
                type="button"
              >
                <span className="material-symbols-outlined">logout</span>
                Log Out
              </button>
            </div>

            <div className="text-center mt-8 pt-6 border-t border-gray-700/20">
              <div className="inline-flex flex-col items-center">
                <p className="text-xs text-gray-500 mb-1 tracking-wider">
                  TECHNOLOGY PARTNER
                </p>
                <p className="text-sm font-medium text-gray-300 tracking-tight">
                  Refora Technologies
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
