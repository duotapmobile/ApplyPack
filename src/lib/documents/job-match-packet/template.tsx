import type { ReactNode } from "react";
import {
  Divider,
  Heading,
  KeepTogether,
  Link,
  List,
  Section,
  Stack,
  Text,
  ThemeProvider,
} from "../pdfcn/components";
import { applyPackPdfTheme } from "../pdfcn/theme";
import type { EvidenceStatement, JobMatchPacketContent, JobMatchPacketEntry, UnknownWarning } from "./schema";

const categoryLabels = {
  DIRECT: "Direct match",
  TRANSFERABLE: "Transferable match",
  DIRECT_AND_TRANSFERABLE: "Direct and transferable match",
} as const;

const warningLabels = {
  NOT_CONFIRMED: "Not confirmed",
  NOT_STATED: "Not stated",
  UNKNOWN: "Unknown",
} as const;

export function JobMatchPacketTemplate({ content }: { content: JobMatchPacketContent }) {
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(content.generatedAt));

  return (
    <ThemeProvider theme={applyPackPdfTheme}>
      <main style={{ color: applyPackPdfTheme.colors.ink, display: "flex", flexDirection: "column", fontFamily: applyPackPdfTheme.typography.body }}>
        <Section style={{ backgroundColor: applyPackPdfTheme.colors.paleViolet, borderLeft: `7px solid ${applyPackPdfTheme.colors.violet}`, padding: 24 }} keepTogether>
          <Stack direction="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: applyPackPdfTheme.colors.navy, fontSize: 13, fontWeight: 800, letterSpacing: 1.3 }}>APPLYPACK</Text>
            <Text style={{ color: applyPackPdfTheme.colors.mutedInk, fontSize: 11.5 }}>Prepared {generated} ET</Text>
          </Stack>
          <Heading level={1} style={{ marginBottom: 2 }}>Your ApplyPack Job Matches</Heading>
          <Text style={{ color: applyPackPdfTheme.colors.violet, fontSize: 17, fontWeight: 700 }}>{content.customerDisplayName}</Text>
          <Text style={{ color: applyPackPdfTheme.colors.mutedInk, fontSize: 13.5 }}>Ten human-reviewed opportunities, with the connections, cautions, and unknowns preserved from the approved record.</Text>
        </Section>

        {content.jobs.map((job, index) => <JobEntry key={job.jobId} job={job} number={index + 1} />)}

        <Section keepTogether={panelFitsTogether(content.disclosures)} style={{ backgroundColor: applyPackPdfTheme.colors.paleYellow, border: `1px solid ${applyPackPdfTheme.colors.yellow}`, padding: 16 }}>
          <Heading level={3}>Before you apply</Heading>
          <List items={content.disclosures} />
        </Section>
      </main>
    </ThemeProvider>
  );
}

function JobEntry({ job, number }: { job: JobMatchPacketEntry; number: number }) {
  const verified = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(job.verifiedAt));

  const details = [
    detail("Location", job.locationDisplay),
    detail("Work arrangement", job.workArrangement),
    detail("Employment type", job.employmentType),
    detail("Compensation", job.compensationDisplay),
    detail("Benefits", job.benefitsDisplay),
    detail("Travel", job.travelRequirements),
    detail("Schedule", job.scheduleDisplay),
    detail("Geographic eligibility", job.geographicEligibility),
  ].filter(Boolean) as ReactNode[];

  return (
    <Section>
      <KeepTogether style={{ borderTop: `4px solid ${applyPackPdfTheme.colors.green}`, paddingTop: 15 }}>
        <Stack direction="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <Text style={{ backgroundColor: applyPackPdfTheme.colors.navy, borderRadius: 999, color: "#ffffff", fontSize: 14, fontWeight: 800, minWidth: 31, padding: "6px 9px", textAlign: "center" }}>{number}</Text>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <Heading level={2} style={{ marginBottom: 2 }}>{job.positionTitle}</Heading>
            <Text style={{ color: applyPackPdfTheme.colors.mutedInk, fontSize: 15, fontWeight: 700 }}>{job.employerName}</Text>
            <Text style={{ color: applyPackPdfTheme.colors.green, fontSize: 12.5, fontWeight: 700 }}>{categoryLabels[job.matchCategory]}</Text>
          </div>
        </Stack>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 11 }}>{details}</div>
      </KeepTogether>

      <Section style={{ marginBottom: 4 }}>
        <KeepTogether><Heading level={3}>Why this matched</Heading><Text>{job.whyMatched}</Text></KeepTogether>
        <List items={job.strongConnections.map(statement)} />
      </Section>

      {job.thingsToConsider.length ? (
        <Section keepTogether={panelFitsTogether(job.thingsToConsider.map((item) => item.statement))} style={{ backgroundColor: "#f9fafb", borderLeft: `3px solid ${applyPackPdfTheme.colors.yellow}`, marginBottom: 4, padding: 12 }}>
          <TitledList title="Things to consider" items={job.thingsToConsider.map(statement)} />
        </Section>
      ) : null}

      {job.unknownWarnings.length ? (
        <Section keepTogether={panelFitsTogether(job.unknownWarnings.map((item) => item.field))} style={{ backgroundColor: applyPackPdfTheme.colors.paleYellow, borderLeft: `3px solid ${applyPackPdfTheme.colors.yellow}`, marginBottom: 4, padding: 12 }}>
          <TitledList title="Important unknowns" items={job.unknownWarnings.map(warning)} />
        </Section>
      ) : null}

      <KeepTogether>
        <Divider style={{ marginBottom: 9 }} />
        <Stack style={{ gap: 4 }}>
          <Text style={{ color: applyPackPdfTheme.colors.mutedInk, fontSize: 11.5 }}>Preferred source: {job.sourceDisplay}</Text>
          <Text style={{ color: applyPackPdfTheme.colors.mutedInk, fontSize: 11.5 }}>Last verified: {verified} ET</Text>
          <Link href={job.directApplicationUrl}>{job.directApplicationUrl}</Link>
        </Stack>
      </KeepTogether>
    </Section>
  );
}

function detail(label: string, value: string | undefined): ReactNode | null {
  if (!value) return null;
  return <Text style={{ backgroundColor: "#f2f4f7", borderRadius: 5, fontSize: 11.5, padding: "5px 7px" }}><strong>{label}:</strong> {value}</Text>;
}


function panelFitsTogether(values: string[]): boolean {
  const estimatedCharacters = values.reduce((total, value) => total + value.length, 0);
  return values.length <= 8 && estimatedCharacters <= 1_500;
}
function statement(value: EvidenceStatement): ReactNode {
  const prefix = value.kind === "GAP" ? "Gap: " : value.kind === "SOFT_PREFERENCE_COMPROMISE" ? "Preference compromise: " : "";
  return <Text style={{ fontSize: 13.3 }}>{prefix}{value.statement}</Text>;
}

function warning(value: UnknownWarning): ReactNode {
  return <Text style={{ fontSize: 13.3 }}><strong>{value.field}:</strong> {warningLabels[value.status]}</Text>;
}

function TitledList({ title, items }: { title: string; items: ReactNode[] }) {
  const [first, ...rest] = items;
  return <><KeepTogether><Heading level={3}>{title}</Heading><List items={[first]} /></KeepTogether>{rest.length ? <List items={rest} /> : null}</>;
}
