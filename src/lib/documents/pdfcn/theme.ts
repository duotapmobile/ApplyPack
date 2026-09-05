export const applyPackPdfTheme = {
  colors: {
    ink: "#101828",
    mutedInk: "#475467",
    navy: "#021185",
    violet: "#5a57e9",
    green: "#027843",
    yellow: "#fdc403",
    paleViolet: "#f4f3ff",
    paleYellow: "#fff9e6",
    border: "#d0d5dd",
    canvas: "#ffffff",
  },
  typography: {
    body: "sans-serif",
    heading: "sans-serif",
    base: 14.6,
    small: 12.4,
    tiny: 10.6,
    lineHeight: 1.46,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 14,
    lg: 22,
    xl: 32,
  },
} as const;

export type ApplyPackPdfTheme = typeof applyPackPdfTheme;
