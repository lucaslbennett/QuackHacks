import { useEffect, useRef } from "react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4";
const SENSITIVITY = 0.8;

export default function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevXRef = useRef<number | null>(null);
  const targetTimeRef = useRef(0);
  const seekingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applySeek = () => {
      if (!video.duration || Number.isNaN(video.duration)) return;

      const clamped = Math.max(
        0,
        Math.min(targetTimeRef.current, video.duration),
      );

      if (Math.abs(video.currentTime - clamped) < 0.01) {
        seekingRef.current = false;
        return;
      }

      seekingRef.current = true;
      video.currentTime = clamped;
    };

    const handleSeeked = () => {
      seekingRef.current = false;
      if (!video.duration || Number.isNaN(video.duration)) return;

      const clamped = Math.max(
        0,
        Math.min(targetTimeRef.current, video.duration),
      );

      if (Math.abs(video.currentTime - clamped) >= 0.01) {
        applySeek();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!video.duration || Number.isNaN(video.duration)) return;

      if (prevXRef.current === null) {
        prevXRef.current = e.clientX;
        return;
      }

      const delta = e.clientX - prevXRef.current;
      prevXRef.current = e.clientX;

      const offset =
        (delta / window.innerWidth) * SENSITIVITY * video.duration;
      targetTimeRef.current = Math.max(
        0,
        Math.min(targetTimeRef.current + offset, video.duration),
      );

      if (!seekingRef.current) {
        applySeek();
      }
    };

    const handleLoadedMetadata = () => {
      targetTimeRef.current = 0;
      video.currentTime = 0;
    };

    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="fixed inset-0 z-0 h-full w-full object-cover object-[70%_center]"
      src={VIDEO_URL}
      muted
      playsInline
      preload="auto"
    />
  );
}
