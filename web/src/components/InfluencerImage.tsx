import { useEffect, useState } from "react";

// An influencer portrait that gracefully falls back to the first letter of the
// name when there's no image_url OR the image fails to load (e.g. a stored
// /media URL whose file was wiped by an ephemeral redeploy). This keeps the
// dashboard from ever showing a broken-image icon.
export default function InfluencerImage({
  src,
  name,
  className = "",
  fallbackClassName = "",
  fallbackTextClassName = "",
}: {
  src: string | null | undefined;
  name: string;
  // Applied to the <img> when an image loads.
  className?: string;
  // Applied to the fallback container (should match the image's box/shape).
  fallbackClassName?: string;
  // Optional sizing for the fallback letter.
  fallbackTextClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset the error state if the source changes (e.g. after regenerating).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const letter = (name || "?").charAt(0).toUpperCase();

  if (!src || failed) {
    return (
      <div className={fallbackClassName}>
        <span className={fallbackTextClassName}>{letter}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
