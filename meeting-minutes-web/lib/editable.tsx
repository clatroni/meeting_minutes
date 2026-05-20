"use client";

import { useState, useEffect, useRef } from "react";

/** Single-line click-to-edit text. */
export function EditableText({ value, onChange, placeholder = "—", className = "" }:
  { value: string | undefined; onChange: (v: string) => void; placeholder?: string; className?: string; }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); inputRef.current?.blur(); }
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        }}
        className={`bg-green-l outline-none rounded px-1 -mx-1 ${className}`}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-text hover:bg-green-l/40 rounded px-1 -mx-1 transition-colors border-b border-dashed border-ink/15 hover:border-green ${className} ${!value ? "text-ink/30 italic" : ""}`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  );
}

/** Multi-line click-to-edit textarea. */
export function EditableTextarea({ value, onChange, placeholder = "—", className = "", rows = 3 }:
  { value: string | undefined; onChange: (v: string) => void; placeholder?: string; className?: string; rows?: number; }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } }}
        rows={rows}
        className={`w-full bg-green-l outline-none rounded p-2 -mx-1 ${className}`}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-text hover:bg-green-l/40 rounded p-1 -m-1 block transition-colors border-l-2 border-dashed border-ink/10 hover:border-green pl-2 ${className} ${!value ? "text-ink/30 italic" : ""}`}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  );
}

/** Dropdown for enum fields (Priority / Status / Risk type / Impact). */
export function EditableSelect<T extends string>({ value, options, onChange, className = "" }:
  { value: T; options: readonly T[]; onChange: (v: T) => void; className?: string; }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`bg-transparent border-0 outline-none cursor-pointer hover:bg-green-l/40 rounded ${className}`}
      title="Change"
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Tiny circular x-button used on array rows. */
export function RemoveButton({ onClick, label = "Remove row" }:
  { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-5 h-5 rounded-full bg-paper hover:bg-red-l hover:text-red text-ink/40 text-[10px] flex items-center justify-center shrink-0"
    >
      ✕
    </button>
  );
}

/** Pill 'Add' button used at the end of array sections. */
export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 text-xs px-3 py-1.5 rounded-full bg-paper hover:bg-green-l text-ink/65 hover:text-green-d transition-colors"
    >
      + {label}
    </button>
  );
}
