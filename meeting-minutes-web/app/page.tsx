"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { SAMPLE_TRANSCRIPTS } from "@/lib/samples";
import { MOM_RULES } from "@/lib/rules";
import { detectLanguage } from "@/lib/lang";
import { momToMarkdown } from "@/lib/mom-to-markdown";
import type { MoM } from "@/lib/types";

type Tone = "executive" | "detailed" | "casual";

type Staged = { text: string; sourceLabel: string };

const PIPELINE_STEPS_SINGLE = [
  { label: "Reading transcript" },
  { label: "Normalising speakers" },
  { label: "Extracting decisions & actions" },
  { label: "Polishing for executive review" },
];
const PIPELINE_STEPS_REVIEW = [
  { label: "Reading transcript" },
  { label: "First extraction pass" },
  { label: "Quality review — fixing missed actions" },
  { label: "Polishing for executive review" },
  { label: "Finalising" },
];

export default function Home() {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mom, setMom] = useState<MoM | null>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tone, setTone] = useState<Tone>("executive");
  const [review, setReview] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) { setStep(0); return; }
    const timings = review ? [600, 6000, 18000, 32000] : [800, 6000, 14000];
    const timers = timings.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [busy, review]);

  const lang = useMemo(() => staged ? detectLanguage(staged.text) : null, [staged]);

  async function stageFile(file: File) {
    setParsing(true); setError(null); setMom(null); setStaged(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setStaged({ text: data.text, sourceLabel: data.sourceLabel });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }

  function stageSample(key: string) {
    const sample = SAMPLE_TRANSCRIPTS[key];
    setError(null); setMom(null);
    setStaged({ text: sample.text, sourceLabel: sample.label });
  }

  async function generate() {
    if (!staged) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: staged.text, tone, review }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMom(data.mom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) stageFile(file);
  }

  function reset() {
    setStaged(null); setMom(null); setError(null);
  }

  const showLanding = !staged && !busy && !mom;
  const showStaged = staged && !busy && !mom;

  return (
    <>
      <main className="w-full max-w-5xl mx-auto px-6 pt-16 pb-24">
        <Hero />

        {showLanding && (
          <>
            <HowItWorks />
            <OutputChips />
            <Settings
              tone={tone} setTone={setTone}
              review={review} setReview={setReview}
              onShowRules={() => setShowRules(true)}
              onShowTemplate={() => setShowTemplate(true)}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 fade-up">
              <Dropzone
                dragging={dragging}
                setDragging={setDragging}
                onDrop={onDrop}
                onPick={() => fileRef.current?.click()}
                parsing={parsing}
              />
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) stageFile(f);
                }}
              />
              <SampleCards onPick={stageSample} />
            </div>
          </>
        )}

        {showStaged && staged && lang && (
          <StagedPreview
            staged={staged}
            lang={lang}
            onChange={(text) => setStaged({ ...staged, text })}
            tone={tone} setTone={setTone}
            review={review} setReview={setReview}
            onShowRules={() => setShowRules(true)}
            onShowTemplate={() => setShowTemplate(true)}
            onCancel={reset}
            onGenerate={generate}
          />
        )}

        {busy && <Processing step={step} review={review} />}

        {error && (
          <div className="bg-red-l text-red-d rounded-[var(--radius-md)] p-5 mt-8 fade-up">
            <strong>Error:</strong> {error}
          </div>
        )}

        {mom && <ResultView mom={mom} onReset={reset} />}
      </main>
      <Footer />

      {showRules && <Modal title="Writing rules (the prompt Claude reads)" onClose={() => setShowRules(false)}>
        <pre className="whitespace-pre-wrap text-sm text-ink/80 leading-relaxed mono">{MOM_RULES}</pre>
        <div className="mt-6 text-xs text-ink/55 bg-paper rounded-[var(--radius-sm)] p-4">
          On the local Streamlit tool these rules live in <span className="mono">input/Rules.docx</span> and can be
          edited in Word without touching code. In this Vercel build they are embedded as a TypeScript
          constant in <span className="mono">lib/rules.ts</span> — editing requires a redeploy.
        </div>
      </Modal>}

      {showTemplate && <Modal title="Output template (Word .docx structure)" onClose={() => setShowTemplate(false)}>
        <TemplatePreview />
      </Modal>}
    </>
  );
}

function Hero() {
  return (
    <header className="text-center md:text-left">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ink text-paper text-[11px] uppercase tracking-[0.18em] mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-green"></span>
        Deloitte
      </div>
      <h1 className="display text-5xl md:text-7xl leading-[1.05] text-ink mb-4">
        Your AI <em className="text-green not-italic font-medium">Meeting Scribe.</em>
      </h1>
      <p className="text-lg text-ink/65 max-w-2xl leading-relaxed mb-5">
        Drop a Microsoft Teams transcript. Get an executive-grade Meeting Minutes record —
        decisions, actions with owners and deadlines, risks, and a download-ready Word document.
      </p>
      <div className="flex flex-wrap gap-2 text-xs text-ink/55 items-center">
        <TrustChip>No login</TrustChip>
        <span className="text-ink/20">·</span>
        <TrustChip>Not stored</TrustChip>
        <span className="text-ink/20">·</span>
        <TrustChip>Done in ~30s</TrustChip>
        <span className="text-ink/20">·</span>
        <TrustChip>Powered by Claude</TrustChip>
      </div>
    </header>
  );
}

function TrustChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink/65">
      <span className="w-1 h-1 rounded-full bg-green"></span>
      {children}
    </span>
  );
}

function HowItWorks() {
  const steps = [
    { icon: "📄", title: "Upload", body: "Teams transcript export (.docx) or paste plain text." },
    { icon: "🤖", title: "Claude reads", body: "Strips fillers, identifies speakers, maps commitments to owners." },
    { icon: "📋", title: "MoM ready", body: "Decisions · actions · risks · timeline. One-click Word download." },
  ];
  return (
    <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 fade-up">
      {steps.map((s, i) => (
        <div key={i} className="bg-white rounded-[var(--radius-md)] shadow-[var(--shadow-sm)] p-5 flex gap-3 items-start">
          <div className="text-2xl shrink-0" aria-hidden>{s.icon}</div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-ink/40 font-medium mb-0.5">Step {i + 1}</div>
            <div className="font-medium mb-1">{s.title}</div>
            <div className="text-xs text-ink/60 leading-relaxed">{s.body}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function OutputChips() {
  const chips = ["Executive summary", "Decisions", "Action items", "Risks & issues", "Timeline", "Open questions", ".docx export"];
  return (
    <div className="mt-6 flex flex-wrap gap-2 fade-up">
      <span className="text-[11px] uppercase tracking-widest text-ink/40 font-medium self-center pr-2">What you get</span>
      {chips.map(c => (
        <span key={c} className="text-xs bg-white px-3 py-1.5 rounded-full shadow-[var(--shadow-sm)]">
          {c}
        </span>
      ))}
    </div>
  );
}

function Settings({ tone, setTone, review, setReview, onShowRules, onShowTemplate }: {
  tone: Tone; setTone: (t: Tone) => void;
  review: boolean; setReview: (b: boolean) => void;
  onShowRules: () => void; onShowTemplate: () => void;
}) {
  return (
    <div className="mt-8 bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-3 fade-up">
      <div className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-widest text-ink/50 font-medium">Tone</span>
        <div className="inline-flex rounded-full bg-paper p-1">
          {(["executive", "detailed", "casual"] as Tone[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors capitalize ${
                tone === t ? "bg-ink text-white" : "text-ink/65 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <span className="text-[11px] uppercase tracking-widest text-ink/50 font-medium">Review pass</span>
        <button
          type="button"
          onClick={() => setReview(!review)}
          className={`relative w-11 h-6 rounded-full transition-colors ${review ? "bg-green" : "bg-ink/15"}`}
          aria-pressed={review}
          title="Second Claude pass auditing the extraction — ~30s extra. Catches missed actions, mis-classified statuses."
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${review ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </label>

      <div className="flex items-center gap-2 ml-auto">
        <button onClick={onShowRules} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors">📖 Rules</button>
        <button onClick={onShowTemplate} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors">📄 Template</button>
      </div>
    </div>
  );
}

function Dropzone({ dragging, setDragging, onDrop, onPick, parsing }:
  { dragging: boolean; setDragging: (b: boolean) => void;
    onDrop: (e: React.DragEvent) => void; onPick: () => void; parsing: boolean; }) {
  return (
    <div
      onClick={parsing ? undefined : onPick}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`dropzone ${dragging ? "dragging" : ""} bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)]
                  p-10 cursor-pointer flex flex-col items-center justify-center text-center min-h-[260px]
                  ${parsing ? "opacity-60 cursor-wait" : ""}`}
    >
      <div className="w-14 h-14 rounded-full bg-green-l flex items-center justify-center mb-4 text-green text-2xl">
        {parsing ? <span className="spinner"></span> : "↑"}
      </div>
      <div className="display text-2xl mb-1">{parsing ? "Reading the file…" : "Drop a transcript"}</div>
      <div className="text-sm text-ink/55 mb-4">.docx (Teams export) · .txt</div>
      {!parsing && (
        <button type="button" className="px-5 py-2 rounded-full bg-ink text-paper text-sm font-medium hover:bg-green hover:text-white transition-colors">
          or browse files →
        </button>
      )}
    </div>
  );
}

function SampleCards({ onPick }: { onPick: (key: string) => void }) {
  return (
    <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-7 flex flex-col">
      <div className="display text-2xl mb-1">Try a sample</div>
      <div className="text-sm text-ink/55 mb-5">Real meeting patterns, sanitised</div>
      <div className="flex flex-col gap-3 flex-1">
        {Object.entries(SAMPLE_TRANSCRIPTS).map(([key, sample]) => (
          <button
            key={key}
            onClick={() => onPick(key)}
            className="text-left p-4 rounded-[var(--radius-md)] bg-paper hover:bg-green-l
                       transition-colors cursor-pointer group flex items-start justify-between gap-3"
          >
            <div>
              <div className="font-medium leading-snug">{sample.label}</div>
              <div className="text-xs text-ink/50 mono mt-1">
                {sample.text.split("\n").length} lines · {sample.text.length} chars
              </div>
            </div>
            <span className="text-ink/30 group-hover:text-green-d group-hover:translate-x-1 transition-all text-xl shrink-0">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StagedPreview({ staged, lang, onChange, tone, setTone, review, setReview,
                       onShowRules, onShowTemplate, onCancel, onGenerate }: {
  staged: Staged;
  lang: ReturnType<typeof detectLanguage>;
  onChange: (text: string) => void;
  tone: Tone; setTone: (t: Tone) => void;
  review: boolean; setReview: (b: boolean) => void;
  onShowRules: () => void; onShowTemplate: () => void;
  onCancel: () => void; onGenerate: () => void;
}) {
  const lines = staged.text.split("\n").length;
  const chars = staged.text.length;
  return (
    <div className="mt-8 space-y-4 fade-up">
      <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-ink/40 font-medium mb-1">Step 1 of 2 · Review the transcript</div>
            <div className="display text-2xl">{staged.sourceLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-3 py-1.5 rounded-full bg-green-l text-green-d flex items-center gap-1.5">
              <span aria-hidden>{lang.flag}</span> {lang.label}
            </span>
            <span className="text-xs px-3 py-1.5 rounded-full bg-paper mono">{lines} lines · {chars} chars</span>
          </div>
        </div>

        <label className="block text-xs uppercase tracking-widest text-ink/40 font-medium mb-2">Edit before sending to Claude</label>
        <textarea
          value={staged.text}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-h-[260px] max-h-[480px] p-4 rounded-[var(--radius-md)] bg-paper border-0 mono text-[13px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-green/40"
          spellCheck={false}
        />
        <div className="mt-2 text-[11px] text-ink/50">Edits are kept client-side and applied when you click Generate.</div>
      </div>

      <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-widest text-ink/50 font-medium">Tone</span>
          <div className="inline-flex rounded-full bg-paper p-1">
            {(["executive", "detailed", "casual"] as Tone[]).map(t => (
              <button key={t} type="button" onClick={() => setTone(t)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors capitalize ${tone === t ? "bg-ink text-white" : "text-ink/65 hover:text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="text-[11px] uppercase tracking-widest text-ink/50 font-medium">Review pass</span>
          <button type="button" onClick={() => setReview(!review)}
            className={`relative w-11 h-6 rounded-full transition-colors ${review ? "bg-green" : "bg-ink/15"}`}
            aria-pressed={review}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${review ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </label>
        <div className="flex items-center gap-2">
          <button onClick={onShowRules} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors">📖 Rules</button>
          <button onClick={onShowTemplate} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors">📄 Template</button>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={onCancel} className="text-sm px-4 py-2 rounded-full bg-white hover:bg-ink hover:text-paper transition-colors">Cancel</button>
          <button onClick={onGenerate} className="text-sm px-5 py-2 rounded-full bg-green text-white hover:bg-green-d transition-colors font-medium">
            Generate MoM →
          </button>
        </div>
      </div>
    </div>
  );
}

function Processing({ step, review }: { step: number; review: boolean }) {
  const steps = review ? PIPELINE_STEPS_REVIEW : PIPELINE_STEPS_SINGLE;
  return (
    <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-10 mt-8 fade-up">
      <div className="flex items-center gap-3 mb-6">
        <span className="spinner"></span>
        <h2 className="display text-3xl">Generating MoM…</h2>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "wait";
          return (
            <li key={i} className="flex items-center gap-4">
              <div className={
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 " +
                (state === "done" ? "bg-green-l text-green-d"
                  : state === "active" ? "step-active"
                  : "bg-paper text-ink/30")
              }>
                {state === "done" ? "✓" : i + 1}
              </div>
              <span className={"text-sm " + (state === "wait" ? "text-ink/40" : "text-ink")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-ink/50 mt-6">
        {review ? "Typically 50–80 seconds with review pass. " : "Typically 30–45 seconds. "}
        Powered by Claude Sonnet 4.6.
      </p>
    </div>
  );
}

function ResultView({ mom, onReset }: { mom: MoM; onReset: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const info = mom.meeting_info;

  const baseName = (() => {
    const slug = (info.title || "MoM").replace(/[^A-Za-z0-9-_]+/g, "_").slice(0, 60);
    return `${info.date || "MoM"}_${slug}_MoM`;
  })();

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadDocx() {
    setDownloading(true);
    try {
      const res = await fetch("/api/render-docx", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mom }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Render failed" }));
        throw new Error(err.error || "Render failed");
      }
      triggerDownload(await res.blob(), `${baseName}.docx`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally { setDownloading(false); }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(mom, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${baseName}.json`);
  }

  async function copyMarkdown() {
    try {
      const md = momToMarkdown(mom);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      alert("Clipboard copy failed — your browser may have blocked it.");
    }
  }

  return (
    <div className="space-y-6 fade-up mt-8">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-xs text-ink/50 mono uppercase tracking-widest">Generated {new Date().toLocaleString()}</div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={downloadDocx} disabled={downloading}
            className="text-sm px-5 py-2 rounded-full bg-green text-white hover:bg-green-d transition-colors disabled:opacity-60 flex items-center gap-2">
            {downloading ? <><span className="spinner !w-3.5 !h-3.5 !border-white/30 !border-t-white"></span> Building Word…</> : <>↓ Download .docx</>}
          </button>
          <button onClick={copyMarkdown}
            className={`text-sm px-4 py-2 rounded-full transition-colors flex items-center gap-2 ${copied ? "bg-green-l text-green-d" : "bg-white hover:bg-paper"}`}
            title="Copy the full MoM as Markdown — paste into Slack / Teams / email">
            {copied ? <>✓ Copied</> : <>⎘ Copy as Markdown</>}
          </button>
          <button onClick={downloadJson}
            className="text-sm px-4 py-2 rounded-full bg-white hover:bg-paper transition-colors"
            title="Download the raw MoM JSON — for downstream automation">
            ↓ .json
          </button>
          <button onClick={onReset} className="text-sm px-4 py-2 rounded-full bg-white hover:bg-ink hover:text-paper transition-colors">↻ New</button>
        </div>
      </div>

      <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
        <h2 className="display text-4xl leading-tight mb-2">{info.title}</h2>
        <div className="text-sm text-ink/55 mono mb-4 flex flex-wrap gap-2">
          {[info.date, info.duration, info.client_name].filter(Boolean).map((bit, i) => (
            <span key={i} className="after:content-['·'] after:ml-2 last:after:content-none">{bit}</span>
          ))}
        </div>
        {info.objective && <p className="text-sm text-ink/70 italic mb-5 max-w-3xl">{info.objective}</p>}
        <div className="flex flex-wrap gap-2">
          {info.participants.map((p, i) => (
            <span key={i} className="text-xs bg-paper px-3 py-1.5 rounded-full">
              <span className="font-medium">{p.name}</span>
              {p.role && <span className="text-ink/55"> · {p.role}</span>}
            </span>
          ))}
        </div>
      </section>

      <SectionCard title="Executive summary"><p className="leading-relaxed text-[15px]">{mom.executive_summary}</p></SectionCard>

      {mom.discussion_topics?.length > 0 && (
        <SectionCard title={`Topics discussed · ${mom.discussion_topics.length}`}>
          <ul className="space-y-4">
            {mom.discussion_topics.map((t, i) => (
              <li key={i} className="pl-4 border-l-2 border-green/40">
                <div className="font-medium mb-1">{t.title}</div>
                <div className="text-sm text-ink/70 leading-relaxed">{t.summary}</div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {mom.decisions_log?.length > 0 && (
        <SectionCard title={`Decisions · ${mom.decisions_log.length}`}>
          <ul className="space-y-4">
            {mom.decisions_log.map((d, i) => (
              <li key={i}>
                <div className="font-medium leading-snug">{d.decision}</div>
                {d.rationale && <div className="text-sm text-ink/60 italic mt-1">{d.rationale}</div>}
                {d.owner && <div className="text-xs text-ink/50 mono mt-1.5">Owner · {d.owner}</div>}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {mom.action_items?.length > 0 && (
        <SectionCard title={`Action items · ${mom.action_items.length}`}>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-ink/40">
                  <th className="pb-3 pr-3 font-medium">Action</th>
                  <th className="pb-3 pr-3 font-medium">Owner</th>
                  <th className="pb-3 pr-3 font-medium">Due</th>
                  <th className="pb-3 pr-3 font-medium">Priority</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {mom.action_items.map((a, i) => (
                  <tr key={i} className="border-t border-paper align-top">
                    <td className="py-4 pr-3">{a.action}</td>
                    <td className="py-4 pr-3 whitespace-nowrap font-medium">{a.owner}</td>
                    <td className="py-4 pr-3 whitespace-nowrap text-ink/60 mono text-xs">{a.due_date}</td>
                    <td className="py-4 pr-3"><PriorityBadge p={a.priority} /></td>
                    <td className="py-4"><StatusBadge s={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {mom.risks_issues && mom.risks_issues.length > 0 && (
        <SectionCard title={`Risks & issues · ${mom.risks_issues.length}`}>
          <ul className="space-y-4">
            {mom.risks_issues.map((r, i) => (
              <li key={i} className="flex gap-4">
                <span className={`text-[11px] px-2.5 py-1 rounded-full shrink-0 h-fit uppercase tracking-wider whitespace-nowrap
                  ${r.type === "Risk" ? "bg-amber-l text-amber" : "bg-red-l text-red"}`}>{r.type} · {r.impact}</span>
                <div className="flex-1">
                  <div className="text-[15px] leading-relaxed">{r.description}</div>
                  {r.owner && <div className="text-xs text-ink/50 mono mt-1">Owner · {r.owner}</div>}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {mom.timeline && mom.timeline.length > 0 && (
        <SectionCard title={`Timeline · ${mom.timeline.length}`}>
          <ul className="space-y-1 text-sm">
            {mom.timeline.map((t, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-2.5 border-t border-paper first:border-t-0">
                <span className="flex-1">{t.milestone}</span>
                <span className="mono text-xs text-ink/60 whitespace-nowrap">{t.date}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {mom.open_questions && mom.open_questions.length > 0 && (
        <SectionCard title={`Open questions · ${mom.open_questions.length}`}>
          <ul className="space-y-2 list-disc pl-5 text-[15px] leading-relaxed">
            {mom.open_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8 fade-up">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-green mb-5 font-medium">{title}</h3>
      {children}
    </section>
  );
}

function PriorityBadge({ p }: { p: "High" | "Medium" | "Low" }) {
  const cls = p === "High" ? "bg-red-l text-red" : p === "Medium" ? "bg-amber-l text-amber" : "bg-paper text-ink/55";
  return <span className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider ${cls}`}>{p}</span>;
}

function StatusBadge({ s }: { s: "Not Started" | "In Progress" | "Completed" }) {
  const cls = s === "Completed" ? "bg-green-l text-green-d"
    : s === "In Progress" ? "bg-blue-l text-blue"
    : "bg-paper text-ink/55";
  return <span className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap ${cls}`}>{s}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 fade-up"
         onClick={onClose}>
      <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] max-w-3xl w-full max-h-[85vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-paper px-6 py-4 flex items-center justify-between rounded-t-[var(--radius-lg)]">
          <h3 className="display text-2xl">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-paper hover:bg-ink hover:text-paper transition-colors flex items-center justify-center">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function TemplatePreview() {
  const sections = [
    { name: "Title block", detail: "Meeting title in Georgia 22pt + date · duration · client (DM Mono small caps)" },
    { name: "Participants", detail: "'Participants:' bold prefix + 'Name (Role)' comma-separated" },
    { name: "Executive summary", detail: "Green-rule heading, then 4–8 prose sentences (Calibri 11)" },
    { name: "Topics discussed", detail: "Bulleted list — bold topic title em-dash summary" },
    { name: "Decisions", detail: "Bulleted — bold decision em-dash rationale (italic) + owner in parentheses" },
    { name: "Action items (table)", detail: "4 columns: Action · Owner · Due · Priority · Status. Header row dark ink + white text. Priority/Status cells shaded by value." },
    { name: "Risks & issues (table)", detail: "Type · Description · Impact · Owner. Type cell shaded by Risk (amber) vs Issue (red)." },
    { name: "Timeline", detail: "Bulleted milestones — bold name em-dash date" },
    { name: "Open questions", detail: "Bulleted list" },
    { name: "Footer", detail: "Italic centred · 'Strictly Private & Confidential · Deloitte'" },
  ];
  return (
    <div>
      <p className="text-sm text-ink/70 mb-5">
        The downloaded Word file follows this structure. Section ordering and styling match a typical
        Deloitte client-facing MoM. Empty sections are omitted automatically.
      </p>
      <ol className="space-y-3">
        {sections.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="w-6 h-6 rounded-full bg-green-l text-green-d text-xs font-medium flex items-center justify-center shrink-0">{i + 1}</span>
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-ink/65 text-xs leading-relaxed">{s.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 text-xs text-ink/55 bg-paper rounded-[var(--radius-sm)] p-4">
        Local Streamlit tool: the visual styling is inherited from <span className="mono">input/Template.docx</span>
        — editable in Word (fonts, colours, header/footer).
        Vercel build: styling is defined in <span className="mono">lib/docx-render.ts</span> using the docx npm
        package — editing requires a redeploy.
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink/8 bg-white/60 backdrop-blur py-6 px-6 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-ink/55">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Strictly Private &amp; Confidential · Deloitte</span>
          <span className="text-ink/20">·</span>
          <span>Server-side Claude</span>
          <span className="text-ink/20">·</span>
          <span>No transcript retention</span>
        </div>
        <div className="mono">Powered by Claude Sonnet 4.6 · Next.js on Vercel</div>
      </div>
    </footer>
  );
}
