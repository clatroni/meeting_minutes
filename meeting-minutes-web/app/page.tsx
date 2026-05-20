"use client";

import { useState, useRef, useEffect } from "react";
import { SAMPLE_TRANSCRIPTS } from "@/lib/samples";
import type { MoM } from "@/lib/types";

const PIPELINE_STEPS = [
  { label: "Reading transcript" },
  { label: "Normalising speakers" },
  { label: "Extracting decisions & actions" },
  { label: "Polishing for executive review" },
];

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mom, setMom] = useState<MoM | null>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Animate pipeline steps while busy (visual feedback; the real work is one API call)
  useEffect(() => {
    if (!busy) { setStep(0); return; }
    const timings = [800, 6000, 12000];
    const timers = timings.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [busy]);

  async function processFile(file: File) {
    setBusy(true); setError(null); setMom(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/process", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMom(data.mom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(false); }
  }

  async function processSample(key: string) {
    setBusy(true); setError(null); setMom(null);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: SAMPLE_TRANSCRIPTS[key].text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMom(data.mom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(false); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <>
      <main className="w-full max-w-5xl mx-auto px-6 pt-16 pb-24">
        <Hero />

        {!mom && !busy && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12 fade-up">
            <Dropzone
              dragging={dragging}
              setDragging={setDragging}
              onDrop={onDrop}
              onPick={() => fileRef.current?.click()}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
              }}
            />
            <SampleCards onPick={processSample} />
          </div>
        )}

        {busy && <Processing step={step} />}

        {error && (
          <div className="bg-red-l text-red-d rounded-[var(--radius-md)] p-5 mt-8 fade-up">
            <strong>Error:</strong> {error}
          </div>
        )}

        {mom && <ResultView mom={mom} onReset={() => setMom(null)} />}
      </main>
      <Footer />
    </>
  );
}

function Hero() {
  return (
    <header className="text-center md:text-left">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ink text-paper text-[11px] uppercase tracking-[0.18em] mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-green"></span>
        Deloitte · AI Prompting Lab
      </div>
      <h1 className="display text-5xl md:text-7xl leading-[1.05] text-ink mb-4">
        Teams transcript.<br />
        <em className="text-green not-italic font-medium">Executive MoM.</em>
      </h1>
      <p className="text-lg text-ink/65 max-w-2xl leading-relaxed">
        Drop a Microsoft Teams transcript. Claude reads it, applies the team's writing rules,
        and returns clean Meeting Minutes — decisions, actions with owners and deadlines,
        risks, and a download-ready Word document.
      </p>
    </header>
  );
}

function Dropzone({ dragging, setDragging, onDrop, onPick }:
  { dragging: boolean; setDragging: (b: boolean) => void;
    onDrop: (e: React.DragEvent) => void; onPick: () => void; }) {
  return (
    <div
      onClick={onPick}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`dropzone ${dragging ? "dragging" : ""} bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)]
                  p-10 cursor-pointer flex flex-col items-center justify-center text-center min-h-[260px]`}
    >
      <div className="w-14 h-14 rounded-full bg-green-l flex items-center justify-center mb-4 text-green text-2xl">
        ↑
      </div>
      <div className="display text-2xl mb-1">Drop a transcript</div>
      <div className="text-sm text-ink/55 mb-4">.docx (Teams export) · .txt</div>
      <button
        type="button"
        className="px-5 py-2 rounded-full bg-ink text-paper text-sm font-medium hover:bg-green hover:text-white transition-colors"
      >
        or browse files →
      </button>
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

function Processing({ step }: { step: number }) {
  return (
    <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-10 mt-8 fade-up">
      <div className="flex items-center gap-3 mb-6">
        <span className="spinner"></span>
        <h2 className="display text-3xl">Generating MoM…</h2>
      </div>
      <ol className="space-y-3">
        {PIPELINE_STEPS.map((s, i) => {
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
              <span className={
                "text-sm " + (state === "wait" ? "text-ink/40" : "text-ink")
              }>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-ink/50 mt-6">Typically 30–45 seconds. Powered by Claude Sonnet 4.6.</p>
    </div>
  );
}

function ResultView({ mom, onReset }: { mom: MoM; onReset: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const info = mom.meeting_info;

  async function downloadDocx() {
    setDownloading(true);
    try {
      const res = await fetch("/api/render-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mom }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Render failed" }));
        throw new Error(err.error || "Render failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = (info.title || "MoM").replace(/[^A-Za-z0-9-_]+/g, "_").slice(0, 60);
      a.download = `${info.date || "MoM"}_${slug}_MoM.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6 fade-up mt-8">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="text-xs text-ink/50 mono uppercase tracking-widest">Generated {new Date().toLocaleString()}</div>
        <div className="flex gap-2">
          <button
            onClick={downloadDocx}
            disabled={downloading}
            className="text-sm px-5 py-2 rounded-full bg-green text-white hover:bg-green-d transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {downloading ? <><span className="spinner !w-3.5 !h-3.5 !border-white/30 !border-t-white"></span> Building Word…</> : <>↓ Download .docx</>}
          </button>
          <button
            onClick={onReset}
            className="text-sm px-4 py-2 rounded-full bg-white hover:bg-ink hover:text-paper transition-colors"
          >
            ↻ New
          </button>
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

      <SectionCard title="Executive summary">
        <p className="leading-relaxed text-[15px]">{mom.executive_summary}</p>
      </SectionCard>

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
                  ${r.type === "Risk" ? "bg-amber-l text-amber" : "bg-red-l text-red"}`}>
                  {r.type} · {r.impact}
                </span>
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
  const cls = p === "High" ? "bg-red-l text-red"
    : p === "Medium" ? "bg-amber-l text-amber"
    : "bg-paper text-ink/55";
  return <span className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider ${cls}`}>{p}</span>;
}

function StatusBadge({ s }: { s: "Not Started" | "In Progress" | "Completed" }) {
  const cls = s === "Completed" ? "bg-green-l text-green-d"
    : s === "In Progress" ? "bg-blue-l text-blue"
    : "bg-paper text-ink/55";
  return <span className={`text-[11px] px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap ${cls}`}>{s}</span>;
}

function Footer() {
  return (
    <footer className="border-t border-ink/8 bg-white/60 backdrop-blur py-6 px-6 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-ink/55">
        <div>Strictly Private &amp; Confidential · Deloitte AI Prompting Lab</div>
        <div className="mono">Powered by Claude Sonnet 4.6 · Next.js on Vercel</div>
      </div>
    </footer>
  );
}
