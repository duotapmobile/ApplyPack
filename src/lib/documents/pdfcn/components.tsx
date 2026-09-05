/*
 * SPDX-License-Identifier: MIT
 * Adapted from pdfcn Takumi registry components at commit
 * 590a1f9421a7561ed94bc3dec5eae46360b28c69.
 * Copyright 2026 Shadcn Labs. ApplyPack-specific adaptations copyright DuoTap LLC.
 */
import { createElement, type CSSProperties, type ReactNode } from "react";
import { PageNumber as TakumiPageNumber, TotalPages } from "takumi-pdf/primitives";
import { applyPackPdfTheme, type ApplyPackPdfTheme } from "./theme";

type BoxProps = { children?: ReactNode; style?: CSSProperties };

export function ThemeProvider({ children, theme = applyPackPdfTheme }: BoxProps & { theme?: ApplyPackPdfTheme }) {
  return <div style={{ color: theme.colors.ink, fontFamily: theme.typography.body }}>{children}</div>;
}

export function Text({ children, style }: BoxProps) {
  const theme = applyPackPdfTheme;
  return <span style={{ color: theme.colors.ink, fontFamily: theme.typography.body, fontSize: theme.typography.base, lineHeight: theme.typography.lineHeight, overflowWrap: "anywhere", ...style }}>{children}</span>;
}

export function Heading({ level = 2, children, style }: BoxProps & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const theme = applyPackPdfTheme;
  const sizes = { 1: 28, 2: 20, 3: 16.5, 4: 14.5, 5: 13, 6: 12 } as const;
  return createElement(`h${level}`, {
    style: {
      color: level === 1 ? theme.colors.navy : theme.colors.ink,
      fontFamily: theme.typography.heading,
      fontSize: sizes[level],
      fontWeight: 700,
      lineHeight: 1.22,
      margin: 0,
      marginBottom: level <= 2 ? theme.spacing.md : theme.spacing.sm,
      overflowWrap: "anywhere",
      ...style,
    },
  }, children);
}

export function Section({ children, style, keepTogether = false }: BoxProps & { keepTogether?: boolean }) {
  const theme = applyPackPdfTheme;
  return <section style={{ display: "flex", flexDirection: "column", gap: theme.spacing.sm, marginBottom: theme.spacing.lg, breakInside: keepTogether ? "avoid" : "auto", ...style }}>{children}</section>;
}

export function Stack({ children, style, direction = "column", gap }: BoxProps & { direction?: "column" | "row"; gap?: number }) {
  const theme = applyPackPdfTheme;
  return <div style={{ display: "flex", flexDirection: direction, gap: gap ?? theme.spacing.sm, ...style }}>{children}</div>;
}

export function List({ items, ordered = false, style }: { items: readonly ReactNode[]; ordered?: boolean; style?: CSSProperties }) {
  const theme = applyPackPdfTheme;
  const Tag = ordered ? "ol" : "ul";
  return <Tag style={{ color: theme.colors.ink, display: "flex", flexDirection: "column", fontFamily: theme.typography.body, fontSize: theme.typography.base, gap: theme.spacing.xs, lineHeight: theme.typography.lineHeight, margin: 0, paddingLeft: 22, ...style }}>{items.map((item, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>{item}</li>)}</Tag>;
}

export function Link({ href, children, style }: BoxProps & { href: string }) {
  const theme = applyPackPdfTheme;
  return <a href={href} style={{ color: theme.colors.navy, fontFamily: theme.typography.body, fontSize: theme.typography.small, lineHeight: 1.35, overflowWrap: "anywhere", textDecoration: "underline", wordBreak: "break-all", ...style }}>{children}</a>;
}

export function Divider({ style }: { style?: CSSProperties }) {
  const theme = applyPackPdfTheme;
  return <div aria-hidden="true" style={{ borderTop: `1px solid ${theme.colors.border}`, height: 0, width: "100%", ...style }} />;
}

export function KeepTogether({ children, style }: BoxProps) {
  return <div style={{ breakInside: "avoid", display: "flex", flexDirection: "column", ...style }}>{children}</div>;
}

export function PageBreak() {
  return <div aria-hidden="true" style={{ breakBefore: "page", height: 0 }} />;
}

export function PageHeader({ left, right, style }: { left: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  const theme = applyPackPdfTheme;
  return <header style={{ alignItems: "center", borderBottom: `1px solid ${theme.colors.border}`, display: "flex", flexDirection: "row", justifyContent: "space-between", paddingBottom: theme.spacing.sm, width: "100%", ...style }}><Text style={{ color: theme.colors.navy, fontSize: theme.typography.tiny, fontWeight: 700, letterSpacing: 0.6 }}>{left}</Text>{right ? <Text style={{ color: theme.colors.mutedInk, fontSize: theme.typography.tiny }}>{right}</Text> : null}</header>;
}

export function PageNumber({ style }: { style?: CSSProperties }) {
  const theme = applyPackPdfTheme;
  const textStyle = { color: theme.colors.mutedInk, fontFamily: theme.typography.body, fontSize: theme.typography.tiny, ...style };
  return <span style={textStyle}>Page <TakumiPageNumber style={textStyle} /> of <TotalPages style={textStyle} /></span>;
}

export function PageFooter({ left, style }: { left: ReactNode; style?: CSSProperties }) {
  const theme = applyPackPdfTheme;
  return <footer style={{ alignItems: "center", borderTop: `1px solid ${theme.colors.border}`, display: "flex", flexDirection: "row", justifyContent: "space-between", paddingTop: theme.spacing.sm, width: "100%", ...style }}><Text style={{ color: theme.colors.mutedInk, fontSize: theme.typography.tiny }}>{left}</Text><PageNumber /></footer>;
}
