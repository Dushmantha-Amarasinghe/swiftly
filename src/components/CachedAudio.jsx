import { useEffect, useState } from "react";
import { loadMedia, saveMedia } from "../lib/cache";
import { AudioBubble } from "../components/ChatShell"; // if ChatShell exports it

export default function CachedAudio({ url, mine }) {
  const [src, setSrc] = useState(url);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cached = await loadMedia(url);
        if (cached && mounted) {
          setSrc(URL.createObjectURL(cached));
        } else {
          const res = await fetch(url);
          const blob = await res.blob();
          await saveMedia(url, blob);
          if (mounted) {
            setSrc(URL.createObjectURL(blob));
          }
        }
      } catch (err) {
        console.error("Error caching audio:", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [url]);

  return <AudioBubble src={src} mine={mine} />;
}