// Gen-3 (GBA) presentation palette. `theme.css` hardcodes these same hex
// values (CSS can't `import` a TS module) — keep the two in sync by hand if
// either changes.
export const UI = {
  fieldBoxFill: "#f8f8f0", fieldBoxBorderOuter: "#40c8a8", fieldBoxBorderInner: "#88e0c8",
  fieldText: "#404048",
  battleBoxFill: "#305858", battleBoxBorder: "#e05828", battleBoxBorderDark: "#702810",
  battleText: "#f8f8f8", battleTextShadow: "#303030",
  panelFill: "#f8f0d8", panelBorder: "#405828",
  hpTag: "#f0a028", hpBar: "#58c838", hpTrack: "#404040", expBar: "#3890f0",
  advanceGlyph: "#e03028",
  encounterBg: "#f0ede0", pinstripe: "#e8e0b8", platform: "#d8c890",
  bannerWood: "#a07040", bannerWoodDark: "#705028", bannerText: "#f8f8f8",
  void: "#a0d8d0",
} as const;
