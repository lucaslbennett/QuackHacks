import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/authContext";
import {
  generateOnboardingCharacter,
  saveGeneration,
  type Character,
} from "../lib/generate";

// The scripted interview. Each question is asked as a chat bubble; the user can
// tap a suggestion chip or type their own answer. `key` is what we send to the
// model as the question label, `id` keys the answers map.
interface Question {
  id: string;
  key: string;
  prompt: string;
  placeholder: string;
  suggestions: string[];
}

const QUESTIONS: Question[] = [
  {
    id: "niche",
    key: "What niche or topic should your influencer cover?",
    prompt:
      "Let's build your AI influencer. First — what's their world? Pick a niche or describe your own.",
    placeholder: "e.g. minimalist home cooking",
    suggestions: ["Fitness & wellness", "Tech & gadgets", "Travel", "Fashion & beauty"],
  },
  {
    id: "audience",
    key: "Who is the target audience?",
    prompt: "Nice. Who are they posting for — who's the audience?",
    placeholder: "e.g. busy professionals in their 30s",
    suggestions: ["Gen Z", "Young professionals", "Parents", "Entrepreneurs"],
  },
  {
    id: "vibe",
    key: "What personality or vibe should they have?",
    prompt: "What's their vibe? This shapes how they talk and look.",
    placeholder: "e.g. warm, funny, a little chaotic",
    suggestions: ["Calm & aspirational", "High-energy & funny", "Bold & edgy", "Cozy & relatable"],
  },
  {
    id: "format",
    key: "What kind of content should they post?",
    prompt: "And what should they actually post? Pick the formats you want.",
    placeholder: "e.g. quick tip reels and day-in-the-life vlogs",
    suggestions: ["Talking-head reels", "Tutorials", "Day-in-the-life vlogs", "Product reviews"],
  },
  {
    id: "look",
    key: "Any preferences for how they look?",
    prompt: "Last one — how should they look? Skip if you want me to decide.",
    placeholder: "e.g. early 20s, warm smile, streetwear",
    suggestions: ["You decide", "Polished & professional", "Natural & casual", "Trendy & stylish"],
  },
];

type Phase = "chat" | "generating" | "reveal" | "error";

interface ChatMessage {
  from: "bot" | "user";
  text: string;
}

const GENERATING_LINES = [
  "Reading your answers…",
  "Designing the persona…",
  "Planning their content…",
  "Rendering the portrait with Nano Banana…",
  "Adding the finishing touches…",
];

interface OnboardingProps {
  // Optional text the user typed in the hero composer; seeds the first answer.
  seed?: string;
  onClose: () => void;
  onComplete: () => void;
  onRequireSignIn: () => void;
}

// Builds the initial chat + answers when the hero seeds the first question.
function initialState(seed?: string) {
  const trimmed = seed?.trim();
  if (!trimmed) {
    return {
      step: 0,
      answers: {} as Record<string, string>,
      messages: [{ from: "bot", text: QUESTIONS[0].prompt }] as ChatMessage[],
    };
  }
  return {
    step: 1,
    answers: { [QUESTIONS[0].key]: trimmed } as Record<string, string>,
    messages: [
      { from: "bot", text: QUESTIONS[0].prompt },
      { from: "user", text: trimmed },
      { from: "bot", text: QUESTIONS[1].prompt },
    ] as ChatMessage[],
  };
}

export default function Onboarding({
  seed,
  onClose,
  onComplete,
  onRequireSignIn,
}: OnboardingProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("chat");
  const seeded = useRef(initialState(seed)).current;
  const [step, setStep] = useState(seeded.step);
  const [answers, setAnswers] = useState<Record<string, string>>(
    seeded.answers,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(seeded.messages);
  const [draft, setDraft] = useState("");

  const [character, setCharacter] = useState<Character | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the conversation pinned to the newest message and refocus the input.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
    if (phase === "chat") inputRef.current?.focus();
  }, [messages, phase]);

  // Cycle the generating copy while we wait on the model.
  useEffect(() => {
    if (phase !== "generating") return;
    const t = setInterval(
      () => setLineIdx((i) => (i + 1) % GENERATING_LINES.length),
      1800,
    );
    return () => clearInterval(t);
  }, [phase]);

  async function runGeneration(finalAnswers: Record<string, string>) {
    setPhase("generating");
    try {
      const result = await generateOnboardingCharacter(finalAnswers);
      setCharacter(result.character);
      setImageUrl(result.imageUrl);
      setPhase("reveal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("error");
    }
  }

  function submitAnswer(value: string) {
    const answer = value.trim();
    if (!answer) return;
    const q = QUESTIONS[step];
    const nextAnswers = { ...answers, [q.key]: answer };
    const nextStep = step + 1;

    setAnswers(nextAnswers);
    setDraft("");
    setMessages((m) => {
      const next: ChatMessage[] = [...m, { from: "user", text: answer }];
      if (nextStep < QUESTIONS.length) {
        next.push({ from: "bot", text: QUESTIONS[nextStep].prompt });
      } else {
        next.push({
          from: "bot",
          text: "Perfect. Bringing your influencer to life…",
        });
      }
      return next;
    });

    if (nextStep < QUESTIONS.length) {
      setStep(nextStep);
    } else {
      setStep(nextStep);
      runGeneration(nextAnswers);
    }
  }

  async function handleSave() {
    if (!imageUrl || !character) return;
    if (!user) {
      onRequireSignIn();
      return;
    }
    setSaveState("saving");
    try {
      await saveGeneration(character.imagePrompt || character.displayName, imageUrl, character);
      setSaveState("saved");
      // Brief beat so the user sees the confirmation, then land on dashboard.
      setTimeout(onComplete, 700);
    } catch {
      setSaveState("idle");
    }
  }

  const showSuggestions =
    phase === "chat" && QUESTIONS[step]?.suggestions?.length > 0;

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-white text-black">
      {/* Top bar with a way out. */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-24 pb-2 sm:px-8">
        <span className="text-[13px] uppercase tracking-[0.15em] text-black/40">
          {phase === "reveal" ? "Your influencer" : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-black/15 text-black/50 transition-colors hover:bg-black hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* ---- Chat ---- */}
      {phase === "chat" && (
        <>
          <div
            ref={scrollRef}
            className="mx-auto w-full max-w-xl flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-0"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.from === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={
                    msg.from === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-md bg-black px-4 py-2.5 text-[15px] text-white"
                      : "max-w-[85%] rounded-2xl rounded-bl-md border border-black/10 bg-black/[0.03] px-4 py-2.5 text-[15px] text-black"
                  }
                  style={
                    msg.from === "bot"
                      ? { fontFamily: "var(--font-heading)", fontSize: "18px" }
                      : undefined
                  }
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          <div className="mx-auto w-full max-w-xl shrink-0 px-5 pb-8 sm:px-0">
            {showSuggestions && (
              <div className="mb-3 flex flex-wrap gap-2">
                {QUESTIONS[step].suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submitAnswer(s)}
                    className="rounded-full border border-black/15 px-3.5 py-1.5 text-[13px] text-black/70 transition-colors duration-200 hover:bg-black hover:text-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitAnswer(draft);
              }}
              className="flex items-center gap-2 rounded-[28px] border border-black/10 bg-white px-2.5 py-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow focus-within:shadow-[0_2px_18px_rgba(0,0,0,0.10)]"
            >
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={QUESTIONS[step]?.placeholder ?? "Type your answer…"}
                className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-black placeholder-black/40 outline-none sm:text-[16px]"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!draft.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-opacity hover:opacity-80 disabled:opacity-30"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 19V5M12 5l-6 6M12 5l6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
            <p className="mt-2 text-center text-[12px] text-black/35">
              Question {Math.min(step + 1, QUESTIONS.length)} of {QUESTIONS.length}
            </p>
          </div>
        </>
      )}

      {/* ---- Generating ---- */}
      {phase === "generating" && (
        <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
          <div className="mb-8 h-10 w-10 animate-spin rounded-full border-2 border-black/15 border-t-black" />
          <h2
            className="mb-2 text-[26px] sm:text-[32px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Creating your influencer
          </h2>
          <p className="text-[14px] text-black/50">{GENERATING_LINES[lineIdx]}</p>
        </div>
      )}

      {/* ---- Reveal ---- */}
      {phase === "reveal" && character && imageUrl && (
        <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 pb-10 sm:px-0">
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 w-full max-w-sm overflow-hidden rounded-2xl border border-black/10 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
              <img
                src={imageUrl}
                alt={character.displayName}
                className="aspect-square w-full object-cover"
              />
            </div>

            <h2
              className="text-[28px] leading-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {character.displayName}
            </h2>
            {character.tagline && (
              <p className="mt-1 text-[15px] text-black/50">{character.tagline}</p>
            )}
            {character.handleSuggestions?.[0] && (
              <p className="mt-1 text-[13px] text-black/40">
                @{character.handleSuggestions[0]}
              </p>
            )}
            {character.bio && (
              <p className="mt-4 max-w-md text-[14px] leading-relaxed text-black/70">
                {character.bio}
              </p>
            )}
          </div>

          {/* What it will post */}
          <div className="mt-8 space-y-6 text-left">
            {character.contentPillars?.length > 0 && (
              <Section title="What they'll post about">
                <div className="flex flex-wrap gap-2">
                  {character.contentPillars.map((p) => (
                    <span
                      key={p}
                      className="rounded-full border border-black/15 px-3.5 py-1.5 text-[13px] text-black/70"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {character.samplePosts?.length > 0 && (
              <Section title="Sample posts">
                <div className="space-y-3">
                  {character.samplePosts.map((post, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-black/10 bg-black/[0.02] p-4"
                    >
                      <p className="text-[14px] font-medium text-black">
                        {post.hook}
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-black/55">
                        {post.caption}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {character.postingStrategy && (
              <Section title="Posting cadence">
                <p className="text-[14px] text-black/70">
                  {character.postingStrategy.postsPerDay}× per day
                  {character.postingStrategy.bestTimes?.length
                    ? ` · best around ${character.postingStrategy.bestTimes
                        .slice(0, 3)
                        .join(", ")}`
                    : ""}
                </p>
              </Section>
            )}
          </div>

          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-black/20 px-6 py-2.5 text-[14px] transition-colors duration-200 hover:bg-black hover:text-white"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "saved"}
              className="rounded-full bg-black px-6 py-2.5 text-[14px] font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-60"
            >
              {saveState === "saved"
                ? "Saved ✓"
                : saveState === "saving"
                  ? "Saving…"
                  : user
                    ? "Launch on dashboard"
                    : "Sign in to launch"}
            </button>
          </div>
          {!user && saveState === "idle" && (
            <p className="mt-3 text-center text-[12px] text-black/40">
              You'll need an account to keep this influencer.
            </p>
          )}
        </div>
      )}

      {/* ---- Error ---- */}
      {phase === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
          <h2
            className="mb-2 text-[26px] sm:text-[32px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Something went wrong
          </h2>
          <p className="mb-6 max-w-sm text-[14px] text-black/50">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-black px-6 py-2.5 text-[14px] font-medium text-white transition-opacity duration-200 hover:opacity-80"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] uppercase tracking-[0.12em] text-black/40">
        {title}
      </h3>
      {children}
    </div>
  );
}
