import { useEffect, useState } from "react";
import { loadMedia, saveMedia } from "../lib/cache"; // <== uses your cache.js

export default function CachedImage({ url, alt = "", className = "" }) {
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
        console.error("Error caching image:", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [url]);

  return (
    <img src={src} alt={alt} className={className} loading="lazy" />
  );
}