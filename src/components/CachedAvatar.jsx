// src/components/CachedAvatar.jsx
export default function CachedAvatar({ url, alt = "", className = "" }) {
  return (
    <img
      src={url || "/logo-swiftly.svg"} 
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.src = "/logo-swiftly.svg"; // fallback when avatar fails
      }}
    />
  );
}