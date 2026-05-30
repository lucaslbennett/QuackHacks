import { spawn } from "node:child_process";
import { writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mediaPath } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("video");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

// Some ffmpeg builds (e.g. minimal Homebrew) ship without the drawtext filter
// or without any usable font. Detect support once so captions degrade
// gracefully instead of failing the whole render.
let _captionSupport = null;
const FONT_CANDIDATES = [
  process.env.FONT_FILE,
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/Library/Fonts/Arial.ttf",
].filter(Boolean);

// Downloads a bundled-quality TTF into the media dir when no system font is
// found, so drawtext captions work on hosts without system fonts (e.g. Railway).
const FONT_URL =
  process.env.FONT_URL ||
  "https://cdn.jsdelivr.net/gh/dejavu-fonts/dejavu-fonts@master/ttf/DejaVuSans-Bold.ttf";

async function ensureFont() {
  const local = FONT_CANDIDATES.find((p) => p && existsSync(p));
  if (local) return local;
  try {
    const dest = await mediaPath("_fonts", "caption.ttf");
    if (existsSync(dest)) return dest;
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`font download ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    log.info("Downloaded caption font to", dest);
    return dest;
  } catch (err) {
    log.warn("could not obtain a caption font:", err.message);
    return null;
  }
}

async function captionSupport() {
  if (_captionSupport) return _captionSupport;
  let hasDrawtext = false;
  try {
    const filters = await run(FFMPEG, ["-hide_banner", "-filters"], { capture: true });
    hasDrawtext = /\bdrawtext\b/.test(filters);
  } catch {
    hasDrawtext = false;
  }
  const fontFile = hasDrawtext ? await ensureFont() : null;
  _captionSupport = { enabled: hasDrawtext, fontFile };
  if (!hasDrawtext) log.warn("ffmpeg has no drawtext filter - captions disabled");
  return _captionSupport;
}

function run(bin, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(capture ? stdout.trim() : { stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function probeDuration(file) {
  try {
    const out = await run(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { capture: true }
    );
    const d = parseFloat(out);
    return Number.isFinite(d) ? d : null;
  } catch (err) {
    log.warn("ffprobe failed:", err.message);
    return null;
  }
}

function escapeDrawText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

// Wraps text to a max line length so captions fit a 1080-wide frame.
function wrap(text, max = 26) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines.join("\n");
}

// Assembles a 9:16 commentary video: visuals (images and/or clips) under a
// voiceover narration, with on-screen caption phrases timed across the video.
export async function assembleReel({
  influencerId,
  contentId,
  audioPath,
  imagePaths = [],
  clipPaths = [],
  captions = [],
}) {
  const W = 1080;
  const H = 1920;
  const audioDur = (await probeDuration(audioPath)) || 20;
  const totalDur = Math.max(5, Math.min(90, audioDur + 0.6));

  // Build the visual base track from available media. Prefer video clips,
  // fall back to images shown as Ken-Burns-ish stills.
  const visuals = [];
  for (const c of clipPaths) visuals.push({ type: "video", path: c });
  for (const i of imagePaths) visuals.push({ type: "image", path: i });
  if (!visuals.length) {
    // Generate a solid gradient background so we always produce a video.
    const bg = await mediaPath(influencerId || "misc", `bg-${Date.now()}.png`);
    await run(FFMPEG, [
      "-y", "-f", "lavfi", "-i", `color=c=0x12121a:s=${W}x${H}`, "-frames:v", "1", bg,
    ]);
    visuals.push({ type: "image", path: bg });
  }

  const perVisual = totalDur / visuals.length;
  const inputs = [];
  const filterParts = [];

  visuals.forEach((v, idx) => {
    if (v.type === "image") {
      inputs.push("-loop", "1", "-t", perVisual.toFixed(2), "-i", v.path);
    } else {
      inputs.push("-stream_loop", "-1", "-t", perVisual.toFixed(2), "-i", v.path);
    }
    // Scale + crop to fill 9:16, then label.
    filterParts.push(
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v${idx}]`
    );
  });

  const concatInputs = visuals.map((_, idx) => `[v${idx}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${visuals.length}:v=1:a=0[base]`);

  // Caption drawtext chain timed evenly across the narration.
  let lastLabel = "base";
  const caps = await captionSupport();
  const phrases = caps.enabled ? (captions || []).filter(Boolean).slice(0, 8) : [];
  if (phrases.length) {
    const seg = totalDur / phrases.length;
    const fontArg = caps.fontFile ? `fontfile='${caps.fontFile}':` : "";
    phrases.forEach((phrase, i) => {
      const start = (i * seg).toFixed(2);
      const end = ((i + 1) * seg).toFixed(2);
      const txt = escapeDrawText(wrap(phrase));
      const out = i === phrases.length - 1 ? "vtext" : `t${i}`;
      filterParts.push(
        `[${lastLabel}]drawtext=${fontArg}text='${txt}':fontcolor=white:fontsize=64:` +
          `box=1:boxcolor=black@0.55:boxborderw=24:line_spacing=10:` +
          `x=(w-text_w)/2:y=h*0.72-text_h/2:` +
          `enable='between(t,${start},${end})'[${out}]`
      );
      lastLabel = out;
    });
  } else {
    filterParts.push(`[base]null[vtext]`);
    lastLabel = "vtext";
  }

  // Audio: narration input is the last input.
  inputs.push("-i", audioPath);
  const audioIdx = visuals.length;

  const filterComplex = filterParts.join(";");
  const out = await mediaPath(influencerId || "misc", `${contentId || Date.now()}.mp4`);

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", `[${lastLabel}]`,
    "-map", `${audioIdx}:a`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-t", totalDur.toFixed(2),
    out,
  ];

  log.info("Rendering reel", out, `(${totalDur.toFixed(1)}s, ${visuals.length} visuals)`);
  await run(FFMPEG, args);
  const { size } = await stat(out);
  log.info("Reel rendered", out, `${size} bytes`);
  return out;
}
