---
name: Lekhan
description: Local-first collaborative knowledge workspace — your second brain, your files, your AI
colors:
  background-light: "#f9f8f4"
  background-dark: "#121313"
  primary-light: "#ff9a00"
  primary-dark: "#fcb41d"
  primary-container: "#ff9a00"
  secondary: "#3b5bdb"
  surface-grey: "#e6e6e6"
  ink: "#1a1a1a"
  on-background-dark: "#e3e3e3"
  on-surface-variant-dark: "#c9bfae"
  error: "#eb0000"
  cream-early: "#f9f8f4"
  teak-early: "#c96a10"
  teak-bright-early: "#eb7d00"
typography:
  display:
    fontFamily: "Montserrat, sans-serif"
    fontWeight: 700
  headline:
    fontFamily: "Inter, sans-serif"
    fontWeight: 600
  body:
    fontFamily: "Inter, sans-serif"
    fontWeight: 400
    lineHeight: 1.6
  editorial-display:
    fontFamily: "Fraunces, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.08
  mono-outlier:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontWeight: 500
rounded:
  default: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  cta: "2.5rem"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  button-hero:
    backgroundColor: "{colors.primary-container}"
    textColor: "#000000"
    rounded: "{rounded.xl}"
    padding: "16px 40px"
  button-ink:
    backgroundColor: "#191713"
    textColor: "{colors.cream-early}"
    rounded: "{rounded.default}"
    padding: "12px 24px"
  header-link:
    textColor: "{colors.on-background-dark}"
    fontSize: "12px"
    fontWeight: 500
---

# Design System — Lekhan (incumbent)

## Overview

Warm editorial-Material hybrid: cream paper in light mode, near-black with warm-tinted surfaces in dark (dark is the site default). Teak-orange primary carries brand warmth; blue is a quiet secondary. Two type worlds coexist: the sitewide Inter/Montserrat Material stack, and the campaign/editorial stack (Fraunces display + Geist body + Geist Mono outlier) introduced on /early. Refinement work preserves both worlds and their boundaries; do not mix editorial type into app UI or Material type into campaign pages without an explicit call.

## Colors

Light: background `#f9f8f4` cream, ink text `#1a1a1a`, primary teak-orange `#ff9a00` (hsl 33 100% 50%), secondary blue hsl(224 54% 50%), error `#eb0000`, outlines neutral grey.

Dark (default): background `#121313` (hsl 180 5% 7%), text `#e3e3e3`, primary shifts warmer/brighter hsl(37 98% 53%), outlines warm grey hsl(32 18% 55%), error lightened hsl(6 100% 84%).

Campaign (/early) fixed palette: cream `#f9f8f4` / ink `#191713` / teak accent `#c96a10` (text-safe) and `hsl(33 100% 46%)` (bright), with a `.dark` remap (paper `#121413`, ink `#f0efeb`, raised `#1b1d1c`). Buttons invert per theme (ink→light surface), never teak.

## Typography

Sitewide: Montserrat 600–700 for display headings, Inter 300–700 for body/UI, Geist available, Material Symbols for icons. Campaign: Fraunces (opsz 9..144, 400–700) display, Geist body, Geist Mono for tabular figures and edition plates only (≤2 outlier slots). Scale follows Tailwind defaults; campaign uses clamp-based fluid sizes with 1.05–1.2 display line-height.

## Layout

Tailwind default spacing scale. Marketing content max-width 1080–1200px centered, px-6/10 gutters. Campaign uses 4-pt-aligned clamp() rhythm, hairline rules (ink at 14–16% alpha) as section dividers, asymmetric Stat-Led hero grid. Mobile floor 320px; grids collapse to one column at 768px.

## Elevation & Depth

Shadows are quiet: `shadow-sm` on chrome, `shadow-2xl shadow-primary-container/20` only on the big CTA slab. Dark mode avoids glow; depth comes from raised surfaces (#1b1d1c on #121313) and hairline borders, not shadows.

## Shapes

Radius 0.5rem default (inputs, buttons), 0.75–1rem for hero buttons and cards, 2.5rem for the marketing CTA slab, 999px for chips/pills. Campaign callouts and plates use 6–8px with 1–1.5px hairline borders.

## Components

Primary button: primary-container bg, ink text, rounded-lg, active:scale-95. Hero CTA: primary bg, black text, rounded-xl, px-10 py-5. Ink button (campaign): #191713 bg / cream text; dark theme inverts to white bg / ink text. Inputs: 1.5px hairline border, raised bg, ink focus ring (campaign). Header links: 12px, medium weight, muted → ink on hover. Toasts: Sonner, fixed position.

## Do's and Don'ts

Do keep dark mode first-class (site default) and verify every surface in both themes. Do keep teak/orange as accent + primary action color in Material contexts; campaign ink-buttons stay neutral. Don't use banned voice words in copy (see PRODUCT.md), don't invent metrics, don't mix Fraunces into app UI, don't let campaign CSS leak (all selectors scoped under .ek-page), don't ship a public surface without 320px + keyboard-focus + reduced-motion checks.
