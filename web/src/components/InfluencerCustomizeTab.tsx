import { useEffect, useMemo, useState } from "react";
import type { Influencer } from "../lib/influencers";
import {
  resetInfluencerPersona,
  updateInfluencerPersona,
} from "../lib/influencers";

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function arrayToLines(value: string[] | string | undefined): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

type SamplePost = { hook: string; caption: string };

type FormState = {
  displayName: string;
  tagline: string;
  niche: string;
  bio: string;
  personality: string;
  appearance: string;
  aesthetic: string;
  imagePrompt: string;
  typicalSettingsText: string;
  typicalOutfitsText: string;
  contentPillarsText: string;
  contentFormatsText: string;
  samplePosts: SamplePost[];
  hashtagThemesText: string;
  briefText: string;
  visualAppearance: string;
  visualAesthetic: string;
  visualSettingsText: string;
  visualWardrobeText: string;
  voiceTone: string;
  voicePacing: string;
  voiceVocabulary: string;
  voiceCatchphrasesText: string;
  voiceGender: string;
  voiceAge: string;
  voiceAccent: string;
  voiceEnergy: string;
  handleSuggestionsText: string;
};

function personaToForm(persona: Influencer["persona"], questionnaire: Record<string, string>): FormState {
  const p = persona || {};
  const vs = p.visualStyle || {};
  const voice = p.voiceStyle || {};
  const casting = p.voiceCasting || {};
  const strategy = p.postingStrategy || {};
  const hashtagThemes = p.hashtagThemes ?? strategy.hashtagThemes ?? [];
  const answers = p.answers || questionnaire || {};
  const briefText =
    Object.keys(answers).length === 1
      ? Object.values(answers)[0] || ""
      : Object.entries(answers)
          .map(([k, v]) => `${k}\n${v}`)
          .join("\n\n");

  return {
    displayName: p.displayName || "",
    tagline: p.tagline || "",
    niche: p.niche || "",
    bio: p.bio || "",
    personality: p.personality || "",
    appearance: p.appearance || vs.appearance || "",
    aesthetic: p.aesthetic || vs.aesthetic || "",
    imagePrompt: p.imagePrompt || "",
    typicalSettingsText: arrayToLines(p.typicalSettings || vs.settings),
    typicalOutfitsText: arrayToLines(p.typicalOutfits || vs.wardrobe),
    contentPillarsText: arrayToLines(p.contentPillars),
    contentFormatsText: arrayToLines(p.contentFormats),
    samplePosts:
      p.samplePosts?.length
        ? p.samplePosts.map((s) => ({
            hook: s.hook || "",
            caption: s.caption || "",
          }))
        : [{ hook: "", caption: "" }],
    hashtagThemesText: arrayToLines(hashtagThemes),
    briefText,
    visualAppearance: vs.appearance || "",
    visualAesthetic: vs.aesthetic || "",
    visualSettingsText: arrayToLines(vs.settings),
    visualWardrobeText: arrayToLines(vs.wardrobe),
    voiceTone: voice.tone || "",
    voicePacing: voice.pacing || "",
    voiceVocabulary: voice.vocabulary || "",
    voiceCatchphrasesText: arrayToLines(voice.catchphrases),
    voiceGender: casting.gender || "",
    voiceAge: casting.age || "",
    voiceAccent: casting.accent || "",
    voiceEnergy: casting.energy || "",
    handleSuggestionsText: (p.handleSuggestions || []).join(", "),
  };
}

function formToPersona(
  form: FormState,
  existing: Influencer["persona"],
  questionnaire: Record<string, string>,
): Influencer["persona"] {
  const prev = existing || {};
  const handles = form.handleSuggestionsText
    .split(/[,;\n]+/)
    .map((h) => h.trim().replace(/^@+/, ""))
    .filter(Boolean);

  const briefTrimmed = form.briefText.trim();
  let answers = prev.answers || questionnaire || {};
  if (briefTrimmed) {
    const keys = Object.keys(answers);
    if (keys.length <= 1) {
      const key = keys[0] || "What niche or topic should your influencer cover?";
      answers = { [key]: briefTrimmed };
    }
  }

  const visualStyle = {
    ...(prev.visualStyle || {}),
    appearance: form.visualAppearance.trim() || undefined,
    aesthetic: form.visualAesthetic.trim() || undefined,
    settings: linesToArray(form.visualSettingsText),
    wardrobe: linesToArray(form.visualWardrobeText),
  };
  const hasVisualStyle = Object.values(visualStyle).some((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  );

  const voiceStyle = {
    ...(prev.voiceStyle || {}),
    tone: form.voiceTone.trim() || undefined,
    pacing: form.voicePacing.trim() || undefined,
    vocabulary: form.voiceVocabulary.trim() || undefined,
    catchphrases: linesToArray(form.voiceCatchphrasesText),
  };
  const hasVoiceStyle = Object.values(voiceStyle).some((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  );

  const voiceCasting = {
    ...(prev.voiceCasting || {}),
    gender: form.voiceGender.trim() || undefined,
    age: form.voiceAge.trim() || undefined,
    accent: form.voiceAccent.trim() || undefined,
    energy: form.voiceEnergy.trim() || undefined,
  };
  const hasVoiceCasting = Object.values(voiceCasting).some(Boolean);

  const samplePosts = form.samplePosts
    .map((s) => ({
      hook: s.hook.trim(),
      caption: s.caption.trim(),
    }))
    .filter((s) => s.hook || s.caption);

  return {
    ...prev,
    displayName: form.displayName.trim(),
    tagline: form.tagline.trim(),
    niche: form.niche.trim(),
    bio: form.bio.trim(),
    personality: form.personality.trim(),
    appearance: form.appearance.trim(),
    aesthetic: form.aesthetic.trim(),
    imagePrompt: form.imagePrompt.trim(),
    typicalSettings: linesToArray(form.typicalSettingsText),
    typicalOutfits: linesToArray(form.typicalOutfitsText),
    contentPillars: linesToArray(form.contentPillarsText),
    contentFormats: linesToArray(form.contentFormatsText),
    samplePosts,
    handleSuggestions: handles,
    answers,
    hashtagThemes: linesToArray(form.hashtagThemesText),
    ...(hasVisualStyle ? { visualStyle } : {}),
    ...(hasVoiceStyle ? { voiceStyle } : {}),
    ...(hasVoiceCasting ? { voiceCasting } : {}),
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-black/70">{label}</span>
      {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-black/45">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[14px] text-black outline-none transition focus:border-[#5b73d6]/50 focus:ring-2 focus:ring-[#5b73d6]/15";

const textareaCls = `${inputCls} min-h-[88px] resize-y leading-relaxed`;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/10 p-5 sm:p-6">
      <h3
        className="text-[18px] text-black"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-black/50">{description}</p>
      )}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export default function InfluencerCustomizeTab({
  influencer,
  onSaved,
}: {
  influencer: Influencer;
  onSaved: (inf: Influencer) => void;
}) {
  const questionnaire = useMemo(
    () =>
      (influencer.persona?.answers as Record<string, string> | undefined) ||
      (influencer as Influencer & { questionnaire?: Record<string, string> }).questionnaire ||
      {},
    [influencer],
  );

  const [form, setForm] = useState<FormState>(() =>
    personaToForm(influencer.persona, questionnaire),
  );
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(personaToForm(influencer.persona, questionnaire));
    setError(null);
    setSavedMsg(null);
  }, [influencer.id, influencer.persona, questionnaire]);

  const hasDefaults = Boolean(influencer.persona?.personaDefaults);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedMsg(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const persona = formToPersona(form, influencer.persona, questionnaire);
      const handle = (persona.handleSuggestions?.[0] || "").trim() || null;
      const updated = await updateInfluencerPersona(influencer.id, persona, {
        name: persona.displayName || influencer.name,
        niche: persona.niche || null,
        handle,
      });
      onSaved(updated);
      setSavedMsg("Saved — new posts will use these settings.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        "Reset all AI customization fields to the original generated defaults? Your edits will be lost.",
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    setSavedMsg(null);
    try {
      const updated = await resetInfluencerPersona(influencer.id);
      onSaved(updated);
      setForm(
        personaToForm(
          updated.persona,
          (updated.persona?.answers as Record<string, string>) || {},
        ),
      );
      setSavedMsg("Restored to defaults.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            className="text-[22px] sm:text-[26px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Customize
          </h2>
          <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-black/55">
            These fields are sent to the AI when generating captions and post images.
            Edit outfits, vibe, voice, and scene lists to steer future content.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting || saving}
            className="rounded-full border border-black/15 px-4 py-2 text-[13px] text-black/70 transition hover:bg-black/[0.04] disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset to defaults"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || resetting}
            className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white transition hover:opacity-80 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {!hasDefaults && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          No launch snapshot saved yet — reset will regenerate from your original
          creation brief if available.
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {savedMsg && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          {savedMsg}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <Section
          title="Voice & identity"
          description="Shapes caption tone and how the creator reads on Instagram."
        >
          <Field label="Display name">
            <input
              className={inputCls}
              value={form.displayName}
              onChange={(e) => patch("displayName", e.target.value)}
            />
          </Field>
          <Field label="Tagline" hint="Short vibe line (not used directly in every post).">
            <input className={inputCls} value={form.tagline} onChange={(e) => patch("tagline", e.target.value)} />
          </Field>
          <Field label="Niche">
            <input className={inputCls} value={form.niche} onChange={(e) => patch("niche", e.target.value)} />
          </Field>
          <Field label="Bio" hint="Reference for caption voice — not copied verbatim.">
            <textarea className={textareaCls} value={form.bio} onChange={(e) => patch("bio", e.target.value)} />
          </Field>
          <Field label="Personality">
            <textarea
              className={textareaCls}
              value={form.personality}
              onChange={(e) => patch("personality", e.target.value)}
            />
          </Field>
          <Field label="Handle suggestions" hint="Comma-separated; first is used as default @handle.">
            <input
              className={inputCls}
              value={form.handleSuggestionsText}
              onChange={(e) => patch("handleSuggestionsText", e.target.value)}
            />
          </Field>
        </Section>

        <Section
          title="Look & portrait"
          description="Used for image generation and the profile portrait prompt."
        >
          <Field label="Appearance" hint="Physical description for new portraits (when no reference).">
            <textarea
              className={textareaCls}
              value={form.appearance}
              onChange={(e) => patch("appearance", e.target.value)}
            />
          </Field>
          <Field label="Aesthetic" hint="Lighting, palette, overall visual mood.">
            <textarea
              className={textareaCls}
              value={form.aesthetic}
              onChange={(e) => patch("aesthetic", e.target.value)}
            />
          </Field>
          <Field label="Portrait image prompt" hint="Rich prompt used for the main profile-style image.">
            <textarea
              className={`${textareaCls} min-h-[120px]`}
              value={form.imagePrompt}
              onChange={(e) => patch("imagePrompt", e.target.value)}
            />
          </Field>
        </Section>

        <Section
          title="Outfits & scenes"
          description="One option per line. The AI picks from these lists for each new post."
        >
          <Field label="Typical settings" hint="Places they post from — gym, kitchen, street, etc.">
            <textarea
              className={`${textareaCls} min-h-[120px] font-mono text-[13px]`}
              value={form.typicalSettingsText}
              onChange={(e) => patch("typicalSettingsText", e.target.value)}
              placeholder={"Neighborhood coffee shop\nHome kitchen\nCity rooftop at dusk"}
            />
          </Field>
          <Field label="Typical outfits" hint="What they wear in posts — vary these to avoid repeats.">
            <textarea
              className={`${textareaCls} min-h-[120px] font-mono text-[13px]`}
              value={form.typicalOutfitsText}
              onChange={(e) => patch("typicalOutfitsText", e.target.value)}
              placeholder={"White linen shirt, relaxed jeans\nGray hoodie, joggers\nSummer dress, sandals"}
            />
          </Field>
        </Section>

        <Section
          title="Content strategy"
          description="Topics, formats, and sample voice for post generation."
        >
          <Field label="Content pillars" hint="One topic per line.">
            <textarea
              className={`${textareaCls} min-h-[100px] font-mono text-[13px]`}
              value={form.contentPillarsText}
              onChange={(e) => patch("contentPillarsText", e.target.value)}
            />
          </Field>
          <Field label="Content formats" hint="e.g. talking-head reels, day-in-the-life.">
            <textarea
              className={`${textareaCls} min-h-[80px] font-mono text-[13px]`}
              value={form.contentFormatsText}
              onChange={(e) => patch("contentFormatsText", e.target.value)}
            />
          </Field>
          <Field label="Hashtag themes" hint="Inspiration for micro-niche tags — one theme per line.">
            <textarea
              className={`${textareaCls} min-h-[80px] font-mono text-[13px]`}
              value={form.hashtagThemesText}
              onChange={(e) => patch("hashtagThemesText", e.target.value)}
            />
          </Field>
          <div>
            <p className="text-[13px] font-medium text-black/70">Sample posts</p>
            <p className="mt-0.5 text-[12px] text-black/45">
              Example captions that set voice — not reused verbatim.
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {form.samplePosts.map((sp, i) => (
                <div key={i} className="rounded-xl border border-black/8 bg-black/[0.02] p-3">
                  <input
                    className={`${inputCls} mb-2`}
                    placeholder="Hook"
                    value={sp.hook}
                    onChange={(e) => {
                      const next = [...form.samplePosts];
                      next[i] = { ...next[i], hook: e.target.value };
                      patch("samplePosts", next);
                    }}
                  />
                  <textarea
                    className={textareaCls}
                    placeholder="Caption"
                    value={sp.caption}
                    onChange={(e) => {
                      const next = [...form.samplePosts];
                      next[i] = { ...next[i], caption: e.target.value };
                      patch("samplePosts", next);
                    }}
                  />
                  {form.samplePosts.length > 1 && (
                    <button
                      type="button"
                      className="mt-2 text-[12px] text-red-600 hover:underline"
                      onClick={() =>
                        patch(
                          "samplePosts",
                          form.samplePosts.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="self-start text-[13px] text-[#5b73d6] hover:underline"
                onClick={() =>
                  patch("samplePosts", [...form.samplePosts, { hook: "", caption: "" }])
                }
              >
                + Add sample post
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="Creation brief"
          description="Original prompt used at onboarding — reset uses this if no snapshot exists."
        >
          <Field label="Brief">
            <textarea
              className={`${textareaCls} min-h-[100px]`}
              value={form.briefText}
              onChange={(e) => patch("briefText", e.target.value)}
            />
          </Field>
        </Section>

        <Section
          title="Visual style (clone)"
          description="Extra visual fields from cloned personas. Settings/outfits here are used if typical lists are empty."
        >
          <Field label="Appearance">
            <textarea
              className={textareaCls}
              value={form.visualAppearance}
              onChange={(e) => patch("visualAppearance", e.target.value)}
            />
          </Field>
          <Field label="Aesthetic">
            <textarea
              className={textareaCls}
              value={form.visualAesthetic}
              onChange={(e) => patch("visualAesthetic", e.target.value)}
            />
          </Field>
          <Field label="Settings" hint="One per line.">
            <textarea
              className={`${textareaCls} font-mono text-[13px]`}
              value={form.visualSettingsText}
              onChange={(e) => patch("visualSettingsText", e.target.value)}
            />
          </Field>
          <Field label="Wardrobe" hint="One per line.">
            <textarea
              className={`${textareaCls} font-mono text-[13px]`}
              value={form.visualWardrobeText}
              onChange={(e) => patch("visualWardrobeText", e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Voice & casting" description="Used for video scripts and voice selection.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tone">
              <input
                className={inputCls}
                value={form.voiceTone}
                onChange={(e) => patch("voiceTone", e.target.value)}
              />
            </Field>
            <Field label="Pacing">
              <input
                className={inputCls}
                value={form.voicePacing}
                onChange={(e) => patch("voicePacing", e.target.value)}
              />
            </Field>
            <Field label="Gender">
              <input
                className={inputCls}
                value={form.voiceGender}
                onChange={(e) => patch("voiceGender", e.target.value)}
              />
            </Field>
            <Field label="Age">
              <input
                className={inputCls}
                value={form.voiceAge}
                onChange={(e) => patch("voiceAge", e.target.value)}
              />
            </Field>
            <Field label="Accent">
              <input
                className={inputCls}
                value={form.voiceAccent}
                onChange={(e) => patch("voiceAccent", e.target.value)}
              />
            </Field>
            <Field label="Energy">
              <input
                className={inputCls}
                value={form.voiceEnergy}
                onChange={(e) => patch("voiceEnergy", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Vocabulary">
            <textarea
              className={textareaCls}
              value={form.voiceVocabulary}
              onChange={(e) => patch("voiceVocabulary", e.target.value)}
            />
          </Field>
          <Field label="Catchphrases" hint="One per line.">
            <textarea
              className={`${textareaCls} font-mono text-[13px]`}
              value={form.voiceCatchphrasesText}
              onChange={(e) => patch("voiceCatchphrasesText", e.target.value)}
            />
          </Field>
        </Section>
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-t border-black/10 pt-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || resetting}
          className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white transition hover:opacity-80 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting || saving}
          className="rounded-full border border-black/15 px-4 py-2 text-[13px] text-black/70 transition hover:bg-black/[0.04] disabled:opacity-50"
        >
          {resetting ? "Resetting…" : "Reset to defaults"}
        </button>
      </div>
    </div>
  );
}
