import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Card, Button } from "../components/ui.jsx";

const QUESTIONS = [
  { key: "vibe", label: "Describe the vibe / personality in a sentence", placeholder: "Bubbly, sarcastic, hype best-friend energy" },
  { key: "audience", label: "Who is the target audience?", placeholder: "Gen-Z fashion lovers, 18-26" },
  { key: "goals", label: "What are this influencer's goals?", placeholder: "Hit 100k followers and land 3 brand deals" },
  { key: "topics", label: "Topics it should commentate on", placeholder: "viral fashion fails, outfit reviews, trends" },
];

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "mt-1 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-brand)]";

export default function Onboard() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "",
    niche: "",
    sourceLinks: "",
    email: "",
    phone: "",
    postsPerDay: 2,
    autoClone: true,
  });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        niche: form.niche,
        questionnaire: answers,
        sourceLinks: form.sourceLinks
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        email: form.email || undefined,
        phone: form.phone || undefined,
        postsPerDay: Number(form.postsPerDay) || 2,
        autoClone: form.autoClone,
      };
      const { influencer } = await api.createInfluencer(body);
      nav(`/influencer/${influencer.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Spawn a new influencer</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Paste the Instagram links of creators to model the persona after. We'll clone their
          style (not their identity) and build a brand-new AI persona.
        </p>
      </div>

      {error && <Card className="text-red-300">{error}</Card>}

      <Card className="space-y-4">
        <Field label="Influencer name *">
          <input className={inputCls} value={form.name} onChange={set("name")} required placeholder="Luna Vibe" />
        </Field>
        <Field label="Niche (optional - we can infer it)">
          <input className={inputCls} value={form.niche} onChange={set("niche")} placeholder="fashion / fitness / commentary" />
        </Field>
        <Field label="Source Instagram accounts to model from (one per line or comma-separated)">
          <textarea
            className={`${inputCls} h-24`}
            value={form.sourceLinks}
            onChange={set("sourceLinks")}
            placeholder={"@someinfluencer\nhttps://instagram.com/another"}
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold text-white">Onboarding questionnaire</h2>
        {QUESTIONS.map((q) => (
          <Field key={q.key} label={q.label}>
            <input
              className={inputCls}
              value={answers[q.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
              placeholder={q.placeholder}
            />
          </Field>
        ))}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold text-white">Account spawning</h2>
        <p className="text-xs text-zinc-400">
          Email + phone are used to auto-create and verify the new Instagram account.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email for signup">
            <input className={inputCls} value={form.email} onChange={set("email")} placeholder="new@yourdomain.com" />
          </Field>
          <Field label="Phone for SMS verification">
            <input className={inputCls} value={form.phone} onChange={set("phone")} placeholder="+15551234567" />
          </Field>
        </div>
        <Field label="Posts per day">
          <input type="number" min="1" max="10" className={inputCls} value={form.postsPerDay} onChange={set("postsPerDay")} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={form.autoClone}
            onChange={(e) => setForm((f) => ({ ...f, autoClone: e.target.checked }))}
          />
          Start cloning the persona immediately
        </label>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Spawning…" : "Spawn influencer"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => history.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
