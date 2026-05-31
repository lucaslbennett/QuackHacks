import { useEffect, useState } from "react";

const CREATORS = [
  {
    name: "Valentina Reyes",
    handle: "@valentinamoves",
    niche: "Wellness",
    stat: "42K",
    image: "/images/valentina-reyes.png",
    colors: "from-[#d9e6d0] via-[#f4e8ca] to-[#dca98c]",
    accent: "bg-[#789b73]",
  },
  {
    name: "Noah Williams",
    handle: "@noahwears",
    niche: "Streetwear",
    stat: "18K",
    image: "/images/noah-williams.png",
    colors: "from-[#bcc3d3] via-[#e8d7c6] to-[#978fa8]",
    accent: "bg-[#6c657d]",
  },
  {
    name: "Sofia Reyes",
    handle: "@sofiaroams",
    niche: "Travel",
    stat: "67K",
    image: "/images/sofia-reyes.jpg",
    colors: "from-[#a8d2df] via-[#f4dca5] to-[#d68f72]",
    accent: "bg-[#408596]",
  },
  {
    name: "Eli Parker",
    handle: "@madebyeli",
    niche: "Food",
    stat: "31K",
    image: "/images/eli-parker.jpg",
    colors: "from-[#f0c3a0] via-[#e4ddad] to-[#a9bc87]",
    accent: "bg-[#a66c4b]",
  },
];

const FAQS = [
  {
    question: "What is an AI influencer?",
    answer:
      "An AI influencer is a digital creator with a consistent identity, visual style, niche, and content plan. Fastpost helps you design the character, generate posts, and publish through connected social accounts.",
  },
  {
    question: "Do I need to write every post myself?",
    answer:
      "No. Give Fastpost a short description of the creator you want. It builds the persona, creates on-brand images and captions, and lets you publish fresh posts from the dashboard.",
  },
  {
    question: "Can I create more than one account?",
    answer:
      "Yes. Build a portfolio of creators for different niches, audiences, and campaigns. Each account keeps its own identity, content history, posting channel, and analytics.",
  },
  {
    question: "How are posts published?",
    answer:
      "Connect a social channel in the dashboard and Fastpost publishes through Postiz. You can review the generated content and keep track of each creator from one workspace.",
  },
  {
    question: "Will every generated creator look the same?",
    answer:
      "No. Your brief shapes the creator's appearance, personality, niche, and visual language. Each persona is designed as a distinct account with its own content direction.",
  },
];

function ArrowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h13m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[11px] text-white">
      +
    </span>
  );
}

function CreatorPortrait({
  image,
  colors,
  compact = false,
}: {
  image: string;
  colors: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${colors} ${
        compact ? "h-11 w-11 rounded-full" : "aspect-[4/5] w-full"
      }`}
    >
      <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}

function CreatorCard({ creator }: { creator: (typeof CREATORS)[number] }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-black/10 bg-white transition-transform duration-300 hover:-translate-y-1">
      <CreatorPortrait image={creator.image} colors={creator.colors} />
      <div className="flex items-end justify-between gap-3 p-4">
        <div>
          <p className="text-[15px] font-medium text-black">{creator.name}</p>
          <p className="mt-0.5 text-[12px] text-black/45">{creator.handle}</p>
        </div>
        <div className="text-right">
          <p className="text-[15px] text-black" style={{ fontFamily: "var(--font-heading)" }}>
            {creator.stat}
          </p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-black/40">Followers</p>
        </div>
      </div>
      <div className="border-t border-black/10 px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-black/45">
        {creator.niche}
      </div>
    </article>
  );
}

function SectionIntro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-black/45">{eyebrow}</p>
      <h2
        className="text-[42px] leading-[0.98] tracking-[-0.03em] text-black sm:text-[62px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {title}
      </h2>
      <p className="mt-5 max-w-xl text-[15px] leading-7 text-black/55 sm:text-[17px]">{copy}</p>
    </div>
  );
}

function PersonaMockup() {
  return (
    <div className="rounded-[24px] border border-black/10 bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
      <div className="rounded-[18px] bg-[#f4f2ed] p-5 sm:p-7">
        <div className="mb-7 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.16em] text-black/45">Persona studio</p>
          <span className="rounded-full bg-black px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-white">
            Ready
          </span>
        </div>
        <div className="flex items-center gap-3">
          <CreatorPortrait image={CREATORS[0].image} colors={CREATORS[0].colors} compact />
          <div>
            <p className="text-[16px] font-medium">Valentina Reyes</p>
            <p className="text-[12px] text-black/45">@valentinamoves</p>
          </div>
        </div>
        <p className="mt-7 text-[24px] leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
          Calm wellness routines for busy mornings.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Movement", "Daily rituals", "Simple meals", "Mindset"].map((pill) => (
            <span key={pill} className="rounded-full border border-black/15 bg-white/60 px-3 py-1.5 text-[11px] text-black/65">
              {pill}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContentMockup() {
  return (
    <div className="grid grid-cols-[0.78fr_1fr] gap-3 rounded-[24px] border border-black/10 bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
      <div className="overflow-hidden rounded-[17px]">
        <CreatorPortrait image={CREATORS[2].image} colors={CREATORS[2].colors} />
      </div>
      <div className="flex flex-col rounded-[17px] bg-[#f4f2ed] p-4">
        <span className="self-start rounded-full bg-black px-2.5 py-1 text-[9px] uppercase tracking-[0.13em] text-white">
          Fresh post
        </span>
        <p className="mt-5 text-[20px] leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
          The quiet corners of Lisbon worth getting lost in.
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-black/50">
          A new image, caption, and hashtag set designed around Sofia&apos;s travel style.
        </p>
        <div className="mt-auto pt-4">
          <div className="h-1.5 rounded-full bg-black/10">
            <div className="h-full w-[72%] rounded-full bg-black" />
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-black/40">Publishing</p>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="rounded-[24px] border border-black/10 bg-[#101010] p-5 text-white shadow-[0_18px_60px_rgba(0,0,0,0.12)] sm:p-7">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">Portfolio analytics</p>
        <span className="flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a7d79d]" />
          Live
        </span>
      </div>
      <p className="mt-8 text-[58px] leading-none" style={{ fontFamily: "var(--font-heading)" }}>
        1.4M
      </p>
      <p className="mt-1 text-[12px] uppercase tracking-[0.15em] text-white/45">Total views</p>
      <svg viewBox="0 0 420 120" className="mt-7 w-full" aria-hidden>
        <path
          d="M0 106 C45 99 58 83 91 87 C124 91 136 57 173 68 C213 80 230 45 263 50 C298 55 311 25 350 29 C377 33 394 10 420 8"
          fill="none"
          stroke="#a7d79d"
          strokeWidth="3"
        />
        <path
          d="M0 106 C45 99 58 83 91 87 C124 91 136 57 173 68 C213 80 230 45 263 50 C298 55 311 25 350 29 C377 33 394 10 420 8 L420 120 L0 120 Z"
          fill="rgba(167,215,157,0.13)"
        />
      </svg>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/15 pt-4">
        {[
          ["92.6K", "Likes"],
          ["5.3K", "Comments"],
          ["+318%", "Growth"],
        ].map(([value, label]) => (
          <div key={label}>
            <p className="text-[20px]" style={{ fontFamily: "var(--font-heading)" }}>{value}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureRow({
  eyebrow,
  title,
  copy,
  bullets,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  bullets: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 border-t border-black/10 py-16 lg:grid-cols-2 lg:gap-20 lg:py-24">
      <div className={reverse ? "lg:order-2" : ""}>
        <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-black/45">{eyebrow}</p>
        <h3
          className="max-w-xl text-[40px] leading-[1.02] tracking-[-0.03em] sm:text-[54px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h3>
        <p className="mt-5 max-w-lg text-[15px] leading-7 text-black/55 sm:text-[16px]">{copy}</p>
        <div className="mt-7 space-y-3">
          {bullets.map((bullet) => (
            <p key={bullet} className="flex items-center gap-3 text-[14px] text-black/70">
              <CheckIcon />
              {bullet}
            </p>
          ))}
        </div>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}

export default function LandingContent({ onGenerate }: { onGenerate: (prompt: string) => void }) {
  const [scrollBoost, setScrollBoost] = useState(0);

  // Move this section upward faster than normal scroll so it slides over the hero.
  useEffect(() => {
    const onScroll = () => {
      const vh = window.innerHeight;
      setScrollBoost(-Math.min(window.scrollY, vh) * 0.38);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main
      className="relative z-[2] bg-[#fbfaf7] text-black shadow-[0_-16px_48px_rgba(0,0,0,0.07)] will-change-transform"
      style={{ transform: `translate3d(0, ${scrollBoost}px, 0)` }}
    >
      <section id="accounts" className="border-t border-black/10 px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <SectionIntro
              eyebrow="A portfolio, not a profile"
              title="Create an account for every idea."
              copy="Launch distinct digital creators across the niches you care about. Each one gets a name, a look, a point of view, and a content engine of its own."
            />
            <button
              type="button"
              onClick={() => onGenerate("")}
              className="inline-flex self-start items-center gap-2 rounded-full bg-black px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-75 md:self-end"
            >
              Create yours
              <ArrowIcon />
            </button>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {CREATORS.map((creator) => <CreatorCard key={creator.handle} creator={creator} />)}
          </div>
        </div>
      </section>

      <section id="product" className="px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <FeatureRow
            eyebrow="01 / Design"
            title="Turn one sentence into a real creator."
            copy="Describe the person you have in mind. Fastpost builds a complete, believable identity with a niche, visual language, bio, content pillars, and posting direction."
            bullets={["Distinct names and handles", "A consistent visual identity", "Content pillars shaped around the niche"]}
            visual={<PersonaMockup />}
          />
          <FeatureRow
            eyebrow="02 / Create and publish"
            title="Keep the feed moving without starting from zero."
            copy="Generate fresh visuals and captions that stay true to each account. Connect a channel, review the result, and send it out without juggling a separate workflow."
            bullets={["Nano Banana Pro image generation", "On-brand captions and hashtags", "Direct publishing through Postiz"]}
            visual={<ContentMockup />}
            reverse
          />
          <FeatureRow
            eyebrow="03 / Learn"
            title="See what your creator portfolio is doing."
            copy="Track content across every account from a single dashboard. Keep an eye on reach and engagement, then use the signal to decide what each creator should make next."
            bullets={["One dashboard for every account", "Live Postiz analytics", "A clear history of generated content"]}
            visual={<AnalyticsMockup />}
          />
        </div>
      </section>

      <section className="bg-black px-5 py-20 text-white sm:px-8 sm:py-28 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.1fr_0.9fr] md:items-end">
          <div>
            <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/45">From idea to feed</p>
            <h2
              className="max-w-3xl text-[46px] leading-[0.98] tracking-[-0.03em] sm:text-[70px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Build the account you keep thinking about.
            </h2>
          </div>
          <div className="md:pb-2">
            <p className="max-w-md text-[15px] leading-7 text-white/60">
              Start with a niche, a style, or half an idea. Fastpost turns it into a creator you can actually manage and grow.
            </p>
            <button
              type="button"
              onClick={() => onGenerate("")}
              className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-medium text-black transition-opacity hover:opacity-75"
            >
              Launch an influencer
              <ArrowIcon />
            </button>
          </div>
        </div>
      </section>

      <section id="faq" className="px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.75fr_1.25fr]">
          <SectionIntro
            eyebrow="FAQ"
            title="A few good questions."
            copy="The short version: describe a creator, generate a post, connect a channel, and keep building."
          />
          <div className="border-t border-black/15">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group border-b border-black/15 py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] text-black marker:hidden sm:text-[19px]">
                  {faq.question}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/15 text-[19px] text-black/55 transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 pr-12 text-[14px] leading-7 text-black/55 sm:text-[15px]">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-black/10 px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <img src="/images/fastpost-logo.png" alt="" className="h-6 w-auto" />
            <span className="text-[26px]" style={{ fontFamily: "var(--font-heading)" }}>Fastpost</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-black/45">
            <a href="#accounts" className="transition-colors hover:text-black">Accounts</a>
            <a href="#product" className="transition-colors hover:text-black">Product</a>
            <a href="#faq" className="transition-colors hover:text-black">FAQ</a>
            <a href="mailto:hello@fastpost.co" className="transition-colors hover:text-black">hello@fastpost.co</a>
          </div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-black/35">Built for creators</p>
        </div>
      </footer>
    </main>
  );
}
