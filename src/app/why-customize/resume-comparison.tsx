"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./why-customize.module.css";

const beforeSummary =
  "Elementary educator with eight years of experience creating lessons, maintaining records, and communicating with families and colleagues.";

const afterSummary =
  "Experienced educator who creates clear instructional materials, guides people through unfamiliar processes, tracks progress, and coordinates follow-up.";

const beforeBullets = [
  "Developed and implemented lesson plans for third-grade students.",
  "Communicated with parents regarding student progress and participated in grade-level meetings.",
];

const afterBullets = [
  "Created step-by-step instructional materials and guided students and families through new processes, answering questions and adjusting support when barriers arose.",
  "Tracked progress, documented results, and coordinated with families and colleagues to keep next steps clear.",
];

function ResumeExcerpt({ version }: { version: "before" | "after" }) {
  const isAfter = version === "after";
  const summary = isAfter ? afterSummary : beforeSummary;
  const bullets = isAfter ? afterBullets : beforeBullets;

  return (
    <article className={styles.resumeSheet}>
      <header className={styles.resumeHeader}>
        <strong>Sarah Bennett</strong>
        <span>Elementary Educator</span>
      </header>
      <section>
        <h3>Professional Summary</h3>
        <p>{summary}</p>
      </section>
      <section>
        <h3>Relevant Experience</h3>
        <div className={styles.roleLine}>
          <strong>Elementary Educator</strong>
          <span>Eight years</span>
        </div>
        <ul>
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </section>
      {isAfter ? (
        <p className={styles.gapNote}>
          <strong>Important gap:</strong> No software onboarding experience is stated.
        </p>
      ) : null}
    </article>
  );
}

function describePosition(position: number) {
  if (position === 0) return "After ApplyPack version shown";
  if (position === 50) return "Split view, half Before and half After ApplyPack";
  if (position === 100) return "Before version shown";
  return `${position} percent Before and ${100 - position} percent After ApplyPack`;
}

export function ResumeComparison() {
  const [position, setPosition] = useState(50);
  const activePointer = useRef<number | null>(null);

  function clamp(value: number) {
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  function positionFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition(clamp(((event.clientX - rect.left) / rect.width) * 100));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    positionFromPointer(event);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    positionFromPointer(event);
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleSliderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next = position;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 5;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 5;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 100;
    else return;

    event.preventDefault();
    setPosition(clamp(next));
  }

  const comparisonStyle = {
    "--comparison-position": `${position}%`,
  } as CSSProperties;

  return (
    <div className={styles.comparison}>
      <div className={styles.targetRole}>
        <span>Target-job requirement</span>
        <p>Guide clients through a new process, maintain clear documentation, track progress, and coordinate follow-up.</p>
      </div>

      <div className={styles.comparisonLabels} aria-hidden="true">
        <span>Before</span>
        <span>After ApplyPack</span>
      </div>

      <div
        className={styles.comparisonCanvas}
        data-testid="resume-comparison-canvas"
        onLostPointerCapture={() => {
          activePointer.current = null;
        }}
        onPointerCancel={endPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        style={comparisonStyle}
      >
        <div aria-hidden="true" className={`${styles.documentLayer} ${styles.beforeLayer}`}>
          <ResumeExcerpt version="before" />
        </div>
        <div aria-hidden="true" className={`${styles.documentLayer} ${styles.afterLayer}`}>
          <ResumeExcerpt version="after" />
        </div>
        <div aria-hidden="true" className={styles.dividerLine} />
        <div
          aria-label="Before and After ApplyPack résumé comparison"
          aria-orientation="horizontal"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={position}
          aria-valuetext={describePosition(position)}
          className={styles.sliderHandle}
          onKeyDown={handleSliderKeyDown}
          role="slider"
          tabIndex={0}
        >
          <span aria-hidden="true">‹</span>
          <span aria-hidden="true">›</span>
        </div>
      </div>

      <p className={styles.comparisonInstruction}>
        Drag to compare, or tap Before and After. Use arrow keys when the divider is focused.
      </p>

      <div className={styles.comparisonButtons} aria-label="Choose a résumé comparison view">
        {[
          ["Before", 100],
          ["Split view", 50],
          ["After", 0],
        ].map(([label, value]) => (
          <button
            aria-pressed={position === value}
            key={label}
            onClick={() => setPosition(Number(value))}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <noscript>
        <p className={styles.noScript}>The interactive divider needs JavaScript. Both complete excerpts are available below.</p>
      </noscript>

      <section aria-labelledby="text-comparison-title" className={styles.textComparison}>
        <div className={styles.textComparisonHeading}>
          <p className={styles.miniEyebrow}>Accessible text comparison</p>
          <h3 id="text-comparison-title">Read both résumé excerpts</h3>
        </div>
        <article>
          <h4>Before</h4>
          <p><strong>Summary:</strong> {beforeSummary}</p>
          <ul>{beforeBullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        </article>
        <article>
          <h4>After ApplyPack</h4>
          <p><strong>Summary:</strong> {afterSummary}</p>
          <ul>{afterBullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
          <p><strong>Important gap:</strong> No software onboarding experience is stated.</p>
        </article>
      </section>
    </div>
  );
}
