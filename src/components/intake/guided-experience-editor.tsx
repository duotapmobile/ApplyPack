"use client";
import { Plus, Trash2 } from "lucide-react";
import { contextualDutySuggestions, experienceDate } from "@/lib/intake/confirmed-review";
import { experienceKindLabels, type ExperienceAddition, type StepError } from "@/lib/intake/four-step";

const split = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
function dateValue(value: string, precision: ExperienceAddition["datePrecision"]) { return value ? experienceDate(value, precision) : ""; }
function dateStorage(value: string, precision: ExperienceAddition["datePrecision"]) {
  if (!value || precision === "UNKNOWN") return "";
  return precision === "YEAR" ? `${value}-01-01` : precision === "MONTH" ? `${value}-01` : value;
}

export function GuidedExperienceEditor({ value, errors, onChange }: { value: ExperienceAddition[]; errors: StepError[]; onChange: (value: ExperienceAddition[]) => void }) {
  const change = (index: number, patch: Partial<ExperienceAddition>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  function add() { onChange([...value, { clientId: crypto.randomUUID(), kind: "PAID_EMPLOYMENT", organizationOrProject: "", roleOrRelationship: "", startsOn: "", endsOn: "", datePrecision: "UNKNOWN", current: false, responsibilities: [], tools: [], scope: "", outcome: "", intensityPercent: null, educationLevel: "", educationField: "", completionStatus: "", certifications: [], relevantCoursework: [], optionalDetail: "" }]); }
  return <section id="experience-additions" className="experience-editor" tabIndex={-1}>
    <h3>Your actual background</h3><p>Add jobs, self-employment, education, projects or volunteering that you want us to use. Short answers are enough. Career breaks and caregiving can be included in your own words; personal details and metrics are optional.</p>
    {value.map((item, index) => { const duties = contextualDutySuggestions(item); const custom = item.responsibilities.filter((task) => !duties.includes(task)); const ownErrors = errors.filter((error) => error.fieldId.startsWith(`experience-${item.clientId}`));
      return <fieldset key={item.clientId} aria-describedby={ownErrors.length ? `experience-errors-${item.clientId}` : undefined}>
        <legend>Experience {index + 1}</legend>
        <div className="field-grid">
          <label>Type<select value={item.kind} onChange={(event) => change(index, { kind: event.target.value as ExperienceAddition["kind"], responsibilities: custom })}>{Object.entries(experienceKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label id={`experience-${item.clientId}-organization`} tabIndex={-1}>Employer, organization, school or project<input value={item.organizationOrProject} onChange={(event) => change(index, { organizationOrProject: event.target.value })} /></label>
          <label>Your actual role or relationship<input value={item.roleOrRelationship} onChange={(event) => change(index, { roleOrRelationship: event.target.value, responsibilities: custom })} /></label>
          <label>How precisely do you know the dates?<select value={item.datePrecision} onChange={(event) => change(index, { datePrecision: event.target.value as ExperienceAddition["datePrecision"], startsOn: "", endsOn: "" })}><option value="UNKNOWN">Dates not known</option><option value="YEAR">Years</option><option value="MONTH">Months and years</option><option value="EXACT_DAY">Exact dates</option></select></label>
          {item.datePrecision !== "UNKNOWN" && <><label>Started<input type={item.datePrecision === "YEAR" ? "number" : item.datePrecision === "MONTH" ? "month" : "date"} min={item.datePrecision === "YEAR" ? "1900" : undefined} max={item.datePrecision === "YEAR" ? "2100" : undefined} key={`start-${item.datePrecision}`} defaultValue={dateValue(item.startsOn, item.datePrecision)} onBlur={(event) => change(index, { startsOn: dateStorage(event.target.value, item.datePrecision) })} /></label>{!item.current && <label id={`experience-${item.clientId}-end`} tabIndex={-1}>Ended<input type={item.datePrecision === "YEAR" ? "number" : item.datePrecision === "MONTH" ? "month" : "date"} min={item.datePrecision === "YEAR" ? "1900" : undefined} max={item.datePrecision === "YEAR" ? "2100" : undefined} key={`end-${item.datePrecision}`} defaultValue={dateValue(item.endsOn, item.datePrecision)} onBlur={(event) => change(index, { endsOn: dateStorage(event.target.value, item.datePrecision) })} /></label>}</>}
        </div>
        <label className="confirm"><input type="checkbox" checked={item.current} onChange={(event) => change(index, { current: event.target.checked, endsOn: event.target.checked ? "" : item.endsOn })} /><span>I still do this / this is current.</span></label>
        {!!duties.length && <fieldset><legend>Did you do any of these in this role?</legend><p>These are suggestions, not facts about you. Select only tasks you actually did.</p>{duties.map((duty) => <label className="confirm" key={duty}><input type="checkbox" checked={item.responsibilities.includes(duty)} onChange={(event) => change(index, { responsibilities: event.target.checked ? [...item.responsibilities, duty] : item.responsibilities.filter((task) => task !== duty) })} /><span>{duty}</span></label>)}</fieldset>}
        <label id={`experience-${item.clientId}-responsibilities`} tabIndex={-1}>{duties.length ? "Other tasks you actually did (optional, one per line)" : "What did you actually do? (short tasks, one per line)"}<textarea defaultValue={custom.join("\n")} key={`${item.clientId}-${item.roleOrRelationship}-${item.kind}`} onBlur={(event) => change(index, { responsibilities: [...item.responsibilities.filter((task) => duties.includes(task)), ...split(event.target.value)] })} /></label>
        {item.kind === "EDUCATION_CERTIFICATION" && <div id={`experience-${item.clientId}-education`} tabIndex={-1} className="field-grid"><label>Degree, course or education level<input value={item.educationLevel} onChange={(event) => change(index, { educationLevel: event.target.value })} /></label><label>Field of study<input value={item.educationField} onChange={(event) => change(index, { educationField: event.target.value })} /></label><label>Completion status<input placeholder="For example: completed, studying, some coursework" value={item.completionStatus} onChange={(event) => change(index, { completionStatus: event.target.value })} /></label></div>}
        <details><summary>Add supporting detail (optional)</summary><p>Skip anything you do not know. You do not need to write polished resume paragraphs.</p>
          <label>Tools you actually used (one per line)<textarea defaultValue={item.tools.join("\n")} onBlur={(event) => change(index, { tools: split(event.target.value) })} /></label>
          <label>Scope or responsibilities you want to explain<textarea value={item.scope} onChange={(event) => change(index, { scope: event.target.value })} /></label>
          <label>Results, if known<textarea value={item.outcome} onChange={(event) => change(index, { outcome: event.target.value })} /></label>
          <label>Credentials or certifications (one per line)<textarea defaultValue={item.certifications.join("\n")} onBlur={(event) => change(index, { certifications: split(event.target.value) })} /></label>
          <label>Relevant coursework (one per line)<textarea defaultValue={item.relevantCoursework.join("\n")} onBlur={(event) => change(index, { relevantCoursework: split(event.target.value) })} /></label>
          <label>Other context you want included<textarea value={item.optionalDetail} onChange={(event) => change(index, { optionalDetail: event.target.value })} /></label>
        </details>
        {!!ownErrors.length && <div id={`experience-errors-${item.clientId}`} role="alert">{ownErrors.map((error) => <p className="field-error" key={error.fieldId}>{error.message}</p>)}</div>}
        <button type="button" className="text-button" onClick={() => onChange(value.filter((_, position) => position !== index))}><Trash2 aria-hidden="true" />Remove experience {index + 1}</button>
      </fieldset>;
    })}
    <button type="button" className="secondary-button" onClick={add}><Plus aria-hidden="true" />Add experience</button>
  </section>;
}
