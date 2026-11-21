# Lekhan web UI reset with Astryx

Replace the public and authenticated visual layer with Astryx. Keep the Lekhan logo, route and service contracts, workspace data, local editing, access controls and referral attribution. Restore the filled Log In link and round moon-style theme control.

## Delivery slices

| ID | Slice | Blocked by | Acceptance |
|---|---|---|---|
| AX-01 | Astryx foundation | — | Pin React-compatible Astryx packages, integrate precompiled CSS and synchronize its theme with the existing page preference. Verify rendering and CSS isolation. |
| AX-02 | Public and authentication | AX-01 | Rebuild the landing narrative and share navigation, spacing and type across public and authentication routes. Confirm waitlist referral and auth behavior. |
| AX-03 | Workbench and settings | AX-01 | Integrate layout and controls across workspace, editor, graph and settings. Keep nested Browse, Recent and Shared, mobile navigation, and one provider and model selection flow. |
| AX-04 | Import and recovery | AX-01, AX-03 | Responsive source cards, progress, report and recovery, using existing import operations. |
| AX-05 | Integration and staging QA | AX-02, AX-03, AX-04 | Run the full suite, exercise 320/375/768/1024/1440 CSS px, verify light/dark, keyboard and focus, capture product proof and run the core staging flow on desktop and physical Android. Preserve the prior deploy for rollback. |

## Product and copy decisions

Lead with the path from Markdown files to a shared workspace. Show real product evidence for vault import, linked pages, search and collaboration. Explain Markdown export and provider choice with claim limits verified on the candidate. Keep early access as the primary marketing action and make confirmation expectations explicit. Use a narrow measure for reading and forms, a wider grid for Workbench, and shared gutters for overlays. Retire legacy styling after each migrated route group.

## Validation

Use synthetic staging fixtures for signup, confirmation, nested import, page persistence, shared roles, collaboration, export and AI provider selection. Cover pending, empty, rejected and recovered states. Run typecheck, lint, unit and integration tests, and a production build. Release QA must identify the candidate commit and staging deployment. Production data migration is outside this spec.
