"use client";

import { useState, useRef } from "react";
import { SAMPLE_TRANSCRIPTS } from "@/lib/samples";
import type { MoM } from "@/lib/types";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mom, setMom] = useState<MoM | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    setBusy(true);
    setError(null);
    setMom(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/process", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMom(data.mom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function processSample(key: string) {
    setBusy(true);
    setError(null);
    setMom(null);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="w-full max-w-4xl mx-auto px-6 py-12">
      <header className="mb-10">
        <div className="inline-block px-3 py-1 rounded-full bg-ink text-paper text-xs uppercase tracking-widest mb-4">
          Deloitte · AI Prompting Lab
        </div>
        <h1 className="text-5xl md:text-6xl text-ink mb-3">
          Teams transcript. <em className="text-green">Executive MoM.</em>
        </h1>
        <p className="text-lg text-ink/70 max-w-2xl">
          Drop a Microsoft Teams transcript (.docx or .txt). Claude reads it, applies the team's writing
          rules, and returns a clean Meeting Minutes record — decisions, actions, owners, risks.
        </p>
      </header>

      {!mom && !busy && (
        <div className="space-y-6">
          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
            <h2 className="text-2xl mb-4">1. Upload a transcript</h2>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
              }}
              className="block w-full text-sm file:mr-4 file:px-5 file:py-3 file:rounded-full file:border-0
                         file:bg-green file:text-white file:font-medium hover:file:bg-green-d
                         file:cursor-pointer cursor-pointer"
            />
            <p className="text-xs text-ink/50 mt-2">Supported: .docx (Teams export), .txt</p>
          </div>

          <div className="text-center text-sm text-ink/50 uppercase tracking-widest">— or —</div>

          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
            <h2 className="text-2xl mb-4">2. Try a sample</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(SAMPLE_TRANSCRIPTS).map(([key, sample]) => (
                <button
                  key={key}
                  onClick={() => processSample(key)}
                  className="text-left p-5 rounded-[var(--radius-md)] border-0 bg-paper hover:bg-green-l
                             transition-colors cursor-pointer"
                >
                  <div className="font-medium mb-1">{sample.label}</div>
                  <div className="text-xs text-ink/50">
                    {sample.text.split("\n").length} lines · {sample.text.length} chars
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-10 text-center">
          <div className="spinner mb-4"></div>
          <h2 className="text-2xl mb-2">Reading the transcript…</h2>
          <p className="text-ink/60 text-sm">Claude is extracting decisions, actions, and risks. Usually 30–40 seconds.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-l text-red-d rounded-[var(--radius-md)] p-5 mt-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      {mom && <ResultView mom={mom} onReset={() => setMom(null)} />}
    </main>
  );
}

function ResultView({ mom, onReset }: { mom: MoM; onReset: () => void }) {
  const info = mom.meeting_info;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-ink/50">Generated · {new Date().toLocaleString()}</div>
        <button
          onClick={onReset}
          className="text-sm px-4 py-2 rounded-full bg-paper hover:bg-ink hover:text-paper transition-colors"
        >
          ↻ New transcript
        </button>
      </div>

      <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
        <h2 className="text-3xl mb-2">{info.title}</h2>
        <div className="text-sm text-ink/60 mb-4">
          {[info.date, info.duration, info.client_name].filter(Boolean).join(" · ")}
        </div>
        {info.objective && <p className="text-sm text-ink/70 italic mb-4">{info.objective}</p>}
        <div className="flex flex-wrap gap-2">
          {info.participants.map((p, i) => (
            <span key={i} className="text-xs bg-paper px-3 py-1 rounded-full">
              {p.name}{p.role ? ` · ${p.role}` : ""}
            </span>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
        <h3 className="text-xs uppercase tracking-widest text-green mb-3">Executive Summary</h3>
        <p className="leading-relaxed">{mom.executive_summary}</p>
      </section>

      {mom.discussion_topics?.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Topics Discussed</h3>
          <ul className="space-y-3">
            {mom.discussion_topics.map((t, i) => (
              <li key={i}>
                <div className="font-medium">{t.title}</div>
                <div className="text-sm text-ink/70">{t.summary}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mom.decisions_log?.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Decisions</h3>
          <ul className="space-y-3">
            {mom.decisions_log.map((d, i) => (
              <li key={i}>
                <div className="font-medium">{d.decision}</div>
                {d.rationale && <div className="text-sm text-ink/60 italic">{d.rationale}</div>}
                {d.owner && <div className="text-xs text-ink/50">Owner: {d.owner}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mom.action_items?.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Action Items</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink/40 border-b border-paper">
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2 pr-3">Owner</th>
                <th className="pb-2 pr-3">Due</th>
                <th className="pb-2 pr-3">Priority</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {mom.action_items.map((a, i) => (
                <tr key={i} className="border-b border-paper/60 align-top">
                  <td className="py-3 pr-3">{a.action}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{a.owner}</td>
                  <td className="py-3 pr-3 whitespace-nowrap text-ink/60">{a.due_date}</td>
                  <td className="py-3 pr-3"><PriorityBadge p={a.priority} /></td>
                  <td className="py-3"><StatusBadge s={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {mom.risks_issues && mom.risks_issues.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Risks &amp; Issues</h3>
          <ul className="space-y-3">
            {mom.risks_issues.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 h-fit ${r.type === "Risk" ? "bg-amber-l text-amber" : "bg-red-l text-red-d"}`}>
                  {r.type} · {r.impact}
                </span>
                <div>
                  <div>{r.description}</div>
                  {r.owner && <div className="text-xs text-ink/50">Owner: {r.owner}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mom.timeline && mom.timeline.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Timeline</h3>
          <ul className="space-y-2 text-sm">
            {mom.timeline.map((t, i) => (
              <li key={i} className="flex justify-between border-b border-paper py-2">
                <span>{t.milestone}</span>
                <span className="font-mono text-xs text-ink/60">{t.date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mom.open_questions && mom.open_questions.length > 0 && (
        <section className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] p-8">
          <h3 className="text-xs uppercase tracking-widest text-green mb-3">Open Questions</h3>
          <ul className="space-y-2 list-disc pl-5">
            {mom.open_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function PriorityBadge({ p }: { p: "High" | "Medium" | "Low" }) {
  const cls = p === "High" ? "bg-red-l text-red-d" : p === "Medium" ? "bg-amber-l text-amber" : "bg-paper text-ink/60";
  return <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{p}</span>;
}

function StatusBadge({ s }: { s: "Not Started" | "In Progress" | "Completed" }) {
  const cls = s === "Completed" ? "bg-green-l text-green-d" : s === "In Progress" ? "bg-blue-l text-blue" : "bg-paper text-ink/60";
  return <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${cls}`}>{s}</span>;
}
