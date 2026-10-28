"use client";
import { useState } from "react";
import { capabilityChoices, type EditableFactValues } from "@/lib/intake/four-step";
import { readableLabel } from "@/lib/intake/confirmed-review";

export function FactLinesInput({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const valueKey = JSON.stringify(value);
  const [buffer, setBuffer] = useState({ valueKey, text: value.join("\n") });
  if (buffer.valueKey !== valueKey) setBuffer({ valueKey, text: value.join("\n") });
  return <label>{label} (one per line)<textarea value={buffer.text} onChange={(event) => {
    const text = event.target.value;
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    setBuffer({ valueKey: JSON.stringify(lines), text });
    onChange(lines);
  }} /></label>;
}

export function FactFieldsEditor({ value, onChange }: { value: EditableFactValues; onChange: (value: EditableFactValues) => void }) {
  return <div className="field-grid"><p>Correct every field that needs it. Unchanged fields stay as shown. Dates may keep their original precision; leave an unknown value empty.</p>{Object.entries(value).map(([key, item]) => {
    const fieldKey = key as keyof EditableFactValues;
    const change = (next: string | string[] | boolean) => onChange({ ...value, [fieldKey]: next });
    const label = key === "verbatim" ? "Correct document statement" : `Correct ${readableLabel(key).toLowerCase()}`;
    if (typeof item === "boolean") return <label className="confirm" key={key}><input type="checkbox" checked={item} onChange={(event) => change(event.target.checked)} /><span>{label}</span></label>;
    if (key === "datePrecision") return <label key={key}>{label}<select value={String(item)} onChange={(event) => change(event.target.value)}><option value="EXACT_DAY">Exact dates</option><option value="MONTH">Months and years</option><option value="YEAR">Years</option><option value="UNKNOWN">Not known</option></select></label>;
    if (key === "capabilityStatus") return <label key={key}>{label}<select value={String(item)} onChange={(event) => change(event.target.value)}>{capabilityChoices.map(([code, text]) => <option value={code} key={code}>{text}</option>)}</select></label>;
    if (Array.isArray(item)) return <FactLinesInput key={key} label={label} value={item} onChange={change} />;
    return <label key={key}>{label}{["text", "verbatim", "summary", "activity", "responsibility"].includes(key)
      ? <textarea value={String(item)} onChange={(event) => change(event.target.value)} />
      : <input type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} value={String(item)} onChange={(event) => change(event.target.value)} />}</label>;
  })}</div>;
}
