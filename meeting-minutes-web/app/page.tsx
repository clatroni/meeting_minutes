"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { SAMPLE_TRANSCRIPTS } from "@/lib/samples";
import { MOM_RULES } from "@/lib/rules";
import { detectLanguage } from "@/lib/lang";
import { momToMarkdown } from "@/lib/mom-to-markdown";
import { EditableText, EditableTextarea, EditableSelect, RemoveButton, AddButton } from "@/lib/editable";
import { DEFAULT_TEMPLATE, loadTemplate, saveTemplate, resetTemplate, titleFor, isEnabled, type SectionConfig, type SectionKey } from "@/lib/template";
import type { MoM, ActionItem, Decision, DiscussionTopic, Risk, TimelineEntry, Participant } from "@/lib/types";
import {
  FileUp, Sparkles, FileCheck, Upload, Download, Copy, Check,
  RotateCcw, Undo2, MoreHorizontal, BookOpen, LayoutTemplate,
  Globe, Languages, ArrowRight, Plus, X, ArrowUp, ArrowDown,
  FileText,
} from "lucide-react";

type Tone = "executive" | "detailed" | "casual";

type Staged = { text: string; sourceLabel: string };

const PIPELINE_STEPS_SINGLE = [
  { label: "Reading transcript" },
  { label: "Normalising speakers" },
  { label: "Extracting decisions & actions" },
  { label: "Polishing for executive review" },
];

export default function Home() {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mom, setMom] = useState<MoM | null>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [template, setTemplate] = useState<SectionConfig[]>(DEFAULT_TEMPLATE);
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate template from localStorage on mount
  useEffect(() => { setTemplate(loadTemplate()); }, []);
  function updateTemplate(next: SectionConfig[]) {
    setTemplate(next);
    saveTemplate(next);
  }
  function doResetTemplate() {
    resetTemplate();
    setTemplate(DEFAULT_TEMPLATE);
  }

  useEffect(() => {
    if (!busy) { setStep(0); return; }
    const timings = [800, 6000, 14000];
    const timers = timings.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [busy]);

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
    const detected = detectLanguage(staged.text);
    const langForPrompt = detected.code === "el" ? "Greek (Ελληνικά)"
      : detected.code === "en" ? "English"
      : "Mixed Greek + English (use the dominant language)";
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: staged.text, tone: "executive", language: langForPrompt }),
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
            <Settings
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
            onShowRules={() => setShowRules(true)}
            onShowTemplate={() => setShowTemplate(true)}
            onCancel={reset}
            onGenerate={generate}
          />
        )}

        {busy && <Processing step={step} />}

        {error && (
          <div className="bg-red-l text-red-d rounded-[var(--radius-md)] p-5 mt-8 fade-up">
            <strong>Error:</strong> {error}
          </div>
        )}

        {mom && <ResultView mom={mom} onReset={reset} template={template}
          transcript={staged?.text || ""}
          transcriptLabel={staged?.sourceLabel}
          onShowRules={() => setShowRules(true)}
          onShowTemplate={() => setShowTemplate(true)} />}
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

      {showTemplate && (
        <Modal title="Output template" onClose={() => setShowTemplate(false)}>
          <TemplateEditor template={template} onChange={updateTemplate} onReset={doResetTemplate} />
        </Modal>
      )}
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
        Teams transcript. <em className="text-green not-italic font-medium">Executive MoM.</em>
      </h1>
      <p className="text-lg text-ink/65 max-w-2xl leading-relaxed mb-5">
        Drop a transcript, get a board-ready Meeting Minutes record — decisions, actions, risks.
      </p>
      <div className="flex flex-wrap gap-4 text-xs items-center">
        <TrustChip>No login</TrustChip>
        <TrustChip>No data stored</TrustChip>
        <TrustChip>30 seconds</TrustChip>
      </div>
    </header>
  );
}

function TrustChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink/65">
      <span className="w-1.5 h-1.5 rounded-full bg-green"></span>
      {children}
    </span>
  );
}

function HowItWorks() {
  const steps = [
    { Icon: FileUp, title: "Upload transcript", body: "Drop a Teams export (.docx) or paste plain text." },
    { Icon: Sparkles, title: "Extract & structure", body: "Speakers, decisions, action items with owners, deadlines, and priority." },
    { Icon: FileCheck, title: "Review & export", body: "Edit any field inline. Download as Word, copy as Markdown, or export JSON." },
  ];
  return (
    <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 fade-up">
      {steps.map(({ Icon, title, body }, i) => (
        <div key={i} className="bg-white rounded-[var(--radius-md)] shadow-[var(--shadow-sm)] p-5">
          <div className="w-10 h-10 rounded-[var(--radius-sm)] bg-green-l text-green-d flex items-center justify-center mb-3">
            <Icon size={20} strokeWidth={1.8} />
          </div>
          <div className="text-[11px] uppercase tracking-widest text-green font-medium mb-1.5">Step {i + 1}</div>
          <div className="font-medium mb-1.5">{title}</div>
          <div className="text-xs text-ink/60 leading-relaxed">{body}</div>
        </div>
      ))}
    </section>
  );
}

function Settings({ onShowRules, onShowTemplate }: {
  onShowRules: () => void; onShowTemplate: () => void;
}) {
  return (
    <div className="mt-8 bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] px-6 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 fade-up">
      <span className="text-xs text-ink/55">Output is tuned for senior stakeholders — concise executive prose.</span>
      <div className="flex items-center gap-2">
        <button onClick={onShowRules} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors inline-flex items-center gap-1.5"><BookOpen size={13} strokeWidth={1.8} /> Rules</button>
        <button onClick={onShowTemplate} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors inline-flex items-center gap-1.5"><LayoutTemplate size={13} strokeWidth={1.8} /> Template</button>
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
      <div className="w-14 h-14 rounded-full bg-green-l flex items-center justify-center mb-4 text-green-d">
        {parsing ? <span className="spinner"></span> : <Upload size={24} strokeWidth={1.8} />}
      </div>
      <div className="display text-2xl mb-1">{parsing ? "Reading the file…" : "Drop a transcript"}</div>
      <div className="text-sm text-ink/55 mb-4">.docx (Teams export) · .txt</div>
      {!parsing && (
        <button type="button" className="px-5 py-2 rounded-full bg-ink text-paper text-sm font-medium hover:bg-green hover:text-white transition-colors">
          or browse files
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
            <ArrowRight size={18} className="text-ink/30 group-hover:text-green-d group-hover:translate-x-1 transition-all shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function StagedPreview({ staged, lang, onChange,
                       onShowRules, onShowTemplate, onCancel, onGenerate }: {
  staged: Staged;
  lang: ReturnType<typeof detectLanguage>;
  onChange: (text: string) => void;
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
        <div className="flex items-center gap-2">
          <button onClick={onShowRules} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors inline-flex items-center gap-1.5"><BookOpen size={13} strokeWidth={1.8} /> Rules</button>
          <button onClick={onShowTemplate} className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l transition-colors inline-flex items-center gap-1.5"><LayoutTemplate size={13} strokeWidth={1.8} /> Template</button>
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

function Processing({ step }: { step: number }) {
  const steps = PIPELINE_STEPS_SINGLE;
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
      <p className="text-xs text-ink/50 mt-6">Typically 30–45 seconds. Powered by Claude Sonnet 4.6.</p>
    </div>
  );
}

function ResultView({ mom: initialMom, onReset, template, transcript, transcriptLabel, onShowRules, onShowTemplate }:
  { mom: MoM; onReset: () => void; template: SectionConfig[];
    transcript: string; transcriptLabel?: string;
    onShowRules: () => void; onShowTemplate: () => void; }) {
  const [mom, setMom] = useState<MoM>(initialMom);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [edited, setEdited] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const generatedAt = useMemo(() => new Date().toLocaleString(), [initialMom]);

  // Sync if a new extraction arrives
  useEffect(() => { setMom(initialMom); setEdited(false); }, [initialMom]);

  function restoreOriginal() {
    setMom(initialMom);
    setEdited(false);
  }

  const info = mom.meeting_info;

  function update(patch: (m: MoM) => MoM) {
    setMom(prev => patch(prev));
    setEdited(true);
  }
  function updateInfo<K extends keyof typeof info>(key: K, value: (typeof info)[K]) {
    update(m => ({ ...m, meeting_info: { ...m.meeting_info, [key]: value } }));
  }
  function updateArray<T>(key: keyof MoM, idx: number, patch: Partial<T>) {
    update(m => {
      const arr = (m[key] as T[] | undefined) || [];
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      return { ...m, [key]: next };
    });
  }
  function addRow<T>(key: keyof MoM, blank: T) {
    update(m => ({ ...m, [key]: [...(((m[key] as T[]) || [])), blank] }));
  }
  function removeRow(key: keyof MoM, idx: number) {
    update(m => {
      const arr = (m[key] as unknown[] | undefined) || [];
      return { ...m, [key]: arr.filter((_, i) => i !== idx) };
    });
  }

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
        body: JSON.stringify({ mom, template }),
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
      const md = momToMarkdown(mom, template);
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
        <div className="text-xs text-ink/50 mono uppercase tracking-widest flex items-center gap-2">
          Generated {generatedAt}
          {edited && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-l text-amber normal-case tracking-normal">
              ✎ Edited locally
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {transcript && (
            <button onClick={() => setShowTranscript(true)} title="View the source transcript"
              className="text-sm px-3 py-2 rounded-full bg-white hover:bg-paper transition-colors inline-flex items-center gap-1.5">
              <FileText size={15} strokeWidth={1.8} /> Transcript
            </button>
          )}
          <button onClick={onShowRules} title="Writing rules"
            className="text-sm px-3 py-2 rounded-full bg-white hover:bg-paper transition-colors inline-flex items-center gap-1.5">
            <BookOpen size={15} strokeWidth={1.8} /> Rules
          </button>
          <button onClick={onShowTemplate} title="Output template"
            className="text-sm px-3 py-2 rounded-full bg-white hover:bg-paper transition-colors inline-flex items-center gap-1.5">
            <LayoutTemplate size={15} strokeWidth={1.8} /> Template
          </button>
          <span className="w-px h-5 bg-ink/10" aria-hidden></span>
          <button onClick={downloadDocx} disabled={downloading}
            className="text-sm px-5 py-2 rounded-full bg-green text-white hover:bg-green-d transition-colors disabled:opacity-60 inline-flex items-center gap-2">
            {downloading ? <><span className="spinner !w-3.5 !h-3.5 !border-white/30 !border-t-white"></span> Building Word…</> : <><Download size={15} strokeWidth={2} /> Download .docx</>}
          </button>
          <div className="relative">
            <button onClick={() => setMoreOpen(v => !v)}
              className="text-sm w-9 h-9 rounded-full bg-white hover:bg-paper transition-colors inline-flex items-center justify-center"
              aria-haspopup="menu" aria-expanded={moreOpen} title="More export options">
              <MoreHorizontal size={16} strokeWidth={1.8} />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div role="menu"
                  className="absolute right-0 top-full mt-2 z-20 bg-white rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] py-1.5 min-w-[240px] fade-up">
                  <button role="menuitem" onClick={() => { copyMarkdown(); setMoreOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-paper transition-colors flex items-center gap-3">
                    {copied ? <><Check size={15} strokeWidth={2.2} className="text-green-d" /> Copied</> : <><Copy size={15} strokeWidth={1.8} /> Copy as Markdown</>}
                  </button>
                  <button role="menuitem" onClick={() => { downloadJson(); setMoreOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-paper transition-colors flex items-center gap-3">
                    <Download size={15} strokeWidth={1.8} /> Download .json
                  </button>
                  {edited && (
                    <button role="menuitem" onClick={() => { restoreOriginal(); setMoreOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-l text-amber-d transition-colors flex items-center gap-3">
                      <Undo2 size={15} strokeWidth={1.8} /> Restore Claude output
                    </button>
                  )}
                  <div className="h-px bg-paper my-1" aria-hidden />
                  <button role="menuitem" onClick={() => { onReset(); setMoreOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-paper transition-colors flex items-center gap-3">
                    <RotateCcw size={15} strokeWidth={1.8} /> Start over
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-green-l/60 text-green-d rounded-[var(--radius-md)] px-4 py-2.5 text-sm flex items-center gap-2 fade-up">
        <Sparkles size={16} strokeWidth={1.8} />
        <span>
          <strong className="font-medium">Tip:</strong> Click any underlined text to edit. Edits carry through to your exports.
        </span>
      </div>

      <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 className="display text-4xl leading-tight">
            <EditableText value={info.title} onChange={(v) => updateInfo("title", v)} placeholder="Untitled meeting" />
          </h2>
          {info.language && (
            <span className="text-xs px-3 py-1.5 rounded-full bg-green-l text-green-d shrink-0 whitespace-nowrap inline-flex items-center gap-1.5">
              {/Mixed|both/i.test(info.language)
                ? <Globe size={13} strokeWidth={1.8} />
                : <Languages size={13} strokeWidth={1.8} />}
              {info.language}
            </span>
          )}
        </div>
        <div className="text-sm text-ink/55 mono mb-4 flex flex-wrap gap-3 items-center">
          <span className="flex items-center gap-1"><span className="text-[10px] uppercase tracking-widest opacity-50">Date</span>
            <EditableText value={info.date} onChange={(v) => updateInfo("date", v)} placeholder="—" /></span>
          <span className="text-ink/20">·</span>
          <span className="flex items-center gap-1"><span className="text-[10px] uppercase tracking-widest opacity-50">Duration</span>
            <EditableText value={info.duration} onChange={(v) => updateInfo("duration", v)} placeholder="—" /></span>
          <span className="text-ink/20">·</span>
          <span className="flex items-center gap-1"><span className="text-[10px] uppercase tracking-widest opacity-50">Client</span>
            <EditableText value={info.client_name} onChange={(v) => updateInfo("client_name", v)} placeholder="—" /></span>
        </div>
        <p className="text-sm text-ink/70 italic mb-5 max-w-3xl">
          <EditableTextarea value={info.objective} onChange={(v) => updateInfo("objective", v)} placeholder="Add meeting objective…" rows={2} />
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {info.participants.map((p, i) => (
            <span key={i} className="text-xs bg-paper px-3 py-1.5 rounded-full flex items-center gap-2">
              <EditableText value={p.name} onChange={(v) => updateInfo("participants",
                info.participants.map((pp, j) => j === i ? { ...pp, name: v } : pp))} className="font-medium" />
              <span className="text-ink/40">·</span>
              <EditableText value={p.role} onChange={(v) => updateInfo("participants",
                info.participants.map((pp, j) => j === i ? { ...pp, role: v } : pp))} className="text-ink/55" placeholder="role" />
              <RemoveButton onClick={() => updateInfo("participants", info.participants.filter((_, j) => j !== i))} />
            </span>
          ))}
          <button
            onClick={() => updateInfo("participants", [...info.participants, { name: "New attendee", role: "" }])}
            className="text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l text-ink/65 hover:text-green-d transition-colors inline-flex items-center gap-1.5"
          >
            <Plus size={12} strokeWidth={2.2} /> Add participant
          </button>
        </div>
      </section>

      {isEnabled(template, "executive_summary") && <SectionCard title={titleFor(template, "executive_summary")}>
        <div className="leading-relaxed text-[15px]">
          <EditableTextarea value={mom.executive_summary}
            onChange={(v) => update(m => ({ ...m, executive_summary: v }))}
            placeholder="Add executive summary…" rows={6} />
        </div>
      </SectionCard>}

      {isEnabled(template, "discussion_topics") && <SectionCard title={`${titleFor(template, "discussion_topics")} · ${mom.discussion_topics?.length || 0}`}>
        <ul className="space-y-4">
          {(mom.discussion_topics || []).map((t, i) => (
            <li key={i} className="pl-4 border-l-2 border-green/40 flex gap-3 items-start group">
              <div className="flex-1">
                <div className="font-medium mb-1">
                  <EditableText value={t.title} onChange={(v) => updateArray<DiscussionTopic>("discussion_topics", i, { title: v })} placeholder="Topic title" />
                </div>
                <div className="text-sm text-ink/70 leading-relaxed">
                  <EditableTextarea value={t.summary} onChange={(v) => updateArray<DiscussionTopic>("discussion_topics", i, { summary: v })} placeholder="Topic summary" rows={2} />
                </div>
              </div>
              <RemoveButton onClick={() => removeRow("discussion_topics", i)} />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => addRow<DiscussionTopic>("discussion_topics", { title: "New topic", summary: "" })} label="Add topic" />
      </SectionCard>}

      {isEnabled(template, "decisions_log") && <SectionCard title={`${titleFor(template, "decisions_log")} · ${mom.decisions_log?.length || 0}`}>
        <ul className="space-y-4">
          {(mom.decisions_log || []).map((d, i) => (
            <li key={i} className="flex gap-3 items-start group">
              <div className="flex-1">
                <div className="font-medium leading-snug">
                  <EditableText value={d.decision} onChange={(v) => updateArray<Decision>("decisions_log", i, { decision: v })} placeholder="Decision text" />
                </div>
                <div className="text-sm text-ink/60 italic mt-1">
                  <EditableText value={d.rationale} onChange={(v) => updateArray<Decision>("decisions_log", i, { rationale: v })} placeholder="Add rationale…" />
                </div>
                <div className="text-xs text-ink/50 mono mt-1.5">
                  Owner ·{" "}
                  <EditableText value={d.owner} onChange={(v) => updateArray<Decision>("decisions_log", i, { owner: v })} placeholder="TBD" />
                </div>
              </div>
              <RemoveButton onClick={() => removeRow("decisions_log", i)} />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => addRow<Decision>("decisions_log", { decision: "New decision", rationale: "", owner: "" })} label="Add decision" />
      </SectionCard>}

      {isEnabled(template, "action_items") && <SectionCard title={`${titleFor(template, "action_items")} · ${mom.action_items?.length || 0}`}>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-ink/40">
                <th className="pb-3 pr-3 font-medium">Action</th>
                <th className="pb-3 pr-3 font-medium">Owner</th>
                <th className="pb-3 pr-3 font-medium">Due</th>
                <th className="pb-3 pr-3 font-medium">Priority</th>
                <th className="pb-3 pr-3 font-medium">Status</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(mom.action_items || []).map((a, i) => (
                <tr key={i} className="border-t border-paper align-top">
                  <td className="py-4 pr-3">
                    <EditableText value={a.action} onChange={(v) => updateArray<ActionItem>("action_items", i, { action: v })} placeholder="Action" />
                  </td>
                  <td className="py-4 pr-3 whitespace-nowrap font-medium">
                    <EditableText value={a.owner} onChange={(v) => updateArray<ActionItem>("action_items", i, { owner: v })} placeholder="TBD" />
                  </td>
                  <td className="py-4 pr-3 whitespace-nowrap text-ink/60 mono text-xs">
                    <EditableText value={a.due_date} onChange={(v) => updateArray<ActionItem>("action_items", i, { due_date: v })} placeholder="TBD" />
                  </td>
                  <td className="py-4 pr-3">
                    <span className="inline-block">
                      <EditableSelect
                        value={a.priority}
                        options={["High", "Medium", "Low"] as const}
                        onChange={(v) => updateArray<ActionItem>("action_items", i, { priority: v })}
                        className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider ${a.priority === "High" ? "bg-red-l text-red" : a.priority === "Medium" ? "bg-amber-l text-amber" : "bg-paper text-ink/55"}`}
                      />
                    </span>
                  </td>
                  <td className="py-4 pr-3">
                    <EditableSelect
                      value={a.status}
                      options={["Not Started", "In Progress", "Completed"] as const}
                      onChange={(v) => updateArray<ActionItem>("action_items", i, { status: v })}
                      className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap ${a.status === "Completed" ? "bg-green-l text-green-d" : a.status === "In Progress" ? "bg-blue-l text-blue" : "bg-paper text-ink/55"}`}
                    />
                  </td>
                  <td className="py-4"><RemoveButton onClick={() => removeRow("action_items", i)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddButton onClick={() => addRow<ActionItem>("action_items", { action: "New action", owner: "TBD", due_date: "TBD", priority: "Medium", status: "Not Started" })} label="Add action" />
      </SectionCard>}

      {isEnabled(template, "risks_issues") && <SectionCard title={`${titleFor(template, "risks_issues")} · ${mom.risks_issues?.length || 0}`}>
        <ul className="space-y-4">
          {(mom.risks_issues || []).map((r, i) => (
            <li key={i} className="flex gap-4 items-start group">
              <div className={`text-[11px] px-2 py-1 rounded-full shrink-0 h-fit uppercase tracking-wider whitespace-nowrap flex items-center gap-1
                ${r.type === "Risk" ? "bg-amber-l text-amber" : "bg-red-l text-red"}`}>
                <EditableSelect value={r.type} options={["Risk", "Issue"] as const}
                  onChange={(v) => updateArray<Risk>("risks_issues", i, { type: v })} className="" />
                <span>·</span>
                <EditableSelect value={r.impact} options={["High", "Medium", "Low"] as const}
                  onChange={(v) => updateArray<Risk>("risks_issues", i, { impact: v })} className="" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] leading-relaxed">
                  <EditableTextarea value={r.description}
                    onChange={(v) => updateArray<Risk>("risks_issues", i, { description: v })}
                    placeholder="Risk / issue description" rows={2} />
                </div>
                <div className="text-xs text-ink/50 mono mt-1">
                  Owner ·{" "}
                  <EditableText value={r.owner} onChange={(v) => updateArray<Risk>("risks_issues", i, { owner: v })} placeholder="TBD" />
                </div>
              </div>
              <RemoveButton onClick={() => removeRow("risks_issues", i)} />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => addRow<Risk>("risks_issues", { type: "Risk", description: "New risk", impact: "Medium", owner: "" })} label="Add risk / issue" />
      </SectionCard>}

      {isEnabled(template, "timeline") && <SectionCard title={`${titleFor(template, "timeline")} · ${mom.timeline?.length || 0}`}>
        <ul className="space-y-1 text-sm">
          {(mom.timeline || []).map((t, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-2.5 border-t border-paper first:border-t-0 group">
              <span className="flex-1">
                <EditableText value={t.milestone} onChange={(v) => updateArray<TimelineEntry>("timeline", i, { milestone: v })} placeholder="Milestone" />
              </span>
              <span className="mono text-xs text-ink/60 whitespace-nowrap flex items-center gap-2">
                <EditableText value={t.date} onChange={(v) => updateArray<TimelineEntry>("timeline", i, { date: v })} placeholder="YYYY-MM-DD" />
                <RemoveButton onClick={() => removeRow("timeline", i)} />
              </span>
            </li>
          ))}
        </ul>
        <AddButton onClick={() => addRow<TimelineEntry>("timeline", { milestone: "New milestone", date: "" })} label="Add milestone" />
      </SectionCard>}

      {isEnabled(template, "open_questions") && <SectionCard title={`${titleFor(template, "open_questions")} · ${mom.open_questions?.length || 0}`}>
        <ul className="space-y-2 text-[15px] leading-relaxed">
          {(mom.open_questions || []).map((q, i) => (
            <li key={i} className="flex gap-2 items-start group">
              <span className="text-green-d">·</span>
              <span className="flex-1">
                <EditableTextarea value={q} onChange={(v) => update(m => ({ ...m, open_questions: (m.open_questions || []).map((qq, j) => j === i ? v : qq) }))} placeholder="Question" rows={1} />
              </span>
              <RemoveButton onClick={() => removeRow("open_questions", i)} />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => update(m => ({ ...m, open_questions: [...(m.open_questions || []), "New question"] }))} label="Add question" />
      </SectionCard>}

      {showTranscript && (
        <Modal title={transcriptLabel || "Source transcript"} onClose={() => setShowTranscript(false)}>
          <div className="text-xs text-ink/55 mb-3 mono">
            {transcript.split("\n").length} lines · {transcript.length} chars
          </div>
          <pre className="whitespace-pre-wrap text-sm text-ink/85 leading-relaxed bg-paper rounded-[var(--radius-sm)] p-4 max-h-[60vh] overflow-y-auto">{transcript}</pre>
          <p className="text-xs text-ink/55 mt-3">
            This is the text that was sent to Claude — including any edits you made on the staged-preview screen before generating.
          </p>
        </Modal>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8 fade-up">
      <h3 className="text-xl font-medium text-ink mb-5 flex items-center gap-3">
        <span className="w-1 h-5 bg-green rounded-full shrink-0" aria-hidden></span>
        {title}
      </h3>
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

function TemplateEditor({ template, onChange, onReset }: {
  template: SectionConfig[]; onChange: (next: SectionConfig[]) => void; onReset: () => void;
}) {
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  function flashSaved() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }
  function setRow(idx: number, patch: Partial<SectionConfig>) {
    onChange(template.map((s, i) => i === idx ? { ...s, ...patch } : s));
    flashSaved();
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= template.length) return;
    const next = [...template];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
    flashSaved();
  }
  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    onReset();
    setConfirmReset(false);
    flashSaved();
  }

  const enabledCount = template.filter(s => s.enabled).length;
  const noneEnabled = enabledCount === 0;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="text-xs text-ink/55 mono">{enabledCount} of {template.length} sections enabled</div>
        {noneEnabled && (
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-l text-amber">⚠ Enable at least 1 section</span>
        )}
        <span
          className={`text-[11px] px-2.5 py-1 rounded-full bg-green-l text-green-d transition-opacity duration-300 ml-auto ${savedFlash ? "opacity-100" : "opacity-0"}`}
          aria-live="polite"
        >
          ✓ Saved
        </span>
      </div>

      <ul className="space-y-2">
        {template.map((s, i) => (
          <li key={s.key}
              className={`flex items-center gap-3 bg-paper rounded-[var(--radius-md)] p-3 transition-opacity ${s.enabled ? "" : "opacity-50"}`}>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                aria-label="Move up"
                className="w-7 h-7 rounded-md bg-white hover:bg-green-l text-ink/65 hover:text-green-d disabled:opacity-30 disabled:hover:bg-white flex items-center justify-center transition-colors">
                <span aria-hidden>▲</span>
              </button>
              <button onClick={() => move(i, 1)} disabled={i === template.length - 1}
                aria-label="Move down"
                className="w-7 h-7 rounded-md bg-white hover:bg-green-l text-ink/65 hover:text-green-d disabled:opacity-30 disabled:hover:bg-white flex items-center justify-center transition-colors">
                <span aria-hidden>▼</span>
              </button>
            </div>
            <button onClick={() => setRow(i, { enabled: !s.enabled })}
              aria-label={s.enabled ? "Disable section" : "Enable section"}
              aria-pressed={s.enabled}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${s.enabled ? "bg-green" : "bg-ink/15"} ${s.enabled ? "" : "opacity-100"}`}
              style={{ opacity: 1 }}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${s.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
            <input
              type="text"
              value={s.title}
              onChange={(e) => setRow(i, { title: e.target.value })}
              className={`flex-1 min-w-0 bg-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green/40 ${s.enabled ? "" : "line-through"}`}
            />
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-ink/55 flex-wrap">
        <span>Click ▲▼ to reorder · toggle to enable · edit the title inline</span>
        <button onClick={handleReset}
          className={`px-3 py-1.5 rounded-full transition-colors ${confirmReset ? "bg-red text-white" : "bg-paper hover:bg-red-l hover:text-red-d"}`}>
          {confirmReset ? "Click again to confirm reset" : "↺ Reset to defaults"}
        </button>
      </div>

      <div className="mt-4 text-xs text-ink/55 bg-paper rounded-[var(--radius-sm)] p-3">
        Note: Claude extracts everything — the template only controls display + export.
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink/8 bg-white/60 backdrop-blur py-6 px-6 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-ink/55">
        <div>Strictly Private &amp; Confidential · No transcript retention</div>
        <div className="mono">Powered by Claude Sonnet 4.6</div>
      </div>
    </footer>
  );
}
