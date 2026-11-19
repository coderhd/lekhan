# Lekhan design system

Lekhan uses Astryx 0.7.16 for interactive primitives and the Neutral theme as a base. The app imports precompiled CSS and keeps Tailwind 3 for unmigrated utilities. Use the same logo on public and authenticated routes.

## Visual direction

Public pages use editorial Georgia headlines and restrained layouts built around real product evidence. The authenticated workspace uses the Astryx typography and icon controls for quick scanning. Warm clay identifies the primary action and warm-neutral surfaces separate navigation, panels and content. Both themes use the same purpose-based tokens. The original filled Log In action and circular theme control remain in the header.

## Layout and controls

Page shells own outer gutters. Public articles use a 70-character measure, Workbench uses fluid padding, and dialogs retain at least 1rem of space from mobile viewport edges. Panels own their internal padding. Use one primary action per task. Interactive cards have one accessible button, and provider and model controls stay compact. Responsive layouts prioritize the page tree, editor and current task.

## State and interaction

Use the saved next-themes preference as the source of truth for Astryx and legacy surfaces. Retain labeled controls, visible keyboard focus, dialog focus return and real loading or recovery states. Use small illustrations for empty or failed views. Keep content readable at 320 CSS px and ensure reused controls provide suitable touch targets.
