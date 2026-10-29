# Cabinet and Board UX release

Published to `https://board.asikmydeen.com` on 2026-09-14.

## Completed scope

1. Shared Friday navigation, typography, controls, and responsive shell.
2. Cabinet landing page prioritises setup and failed runs; briefing and creation use focused dialogs.
3. Advisor cards have identity, readable state, a contextual primary action, and secondary menus.
4. Three-question guided setup with Back, draft-preserving Skip, progress, and a completion summary.
5. Setup suggestions, visibility settings, review dates, and history progressively expand.
6. Saves update in place, retain forms and neighbouring drafts, expose receipts, and support undo by revision.
7. Advisor requests and live run results share one view; Activity updates in place. Result links connect to existing task/PR URLs when provided. Delivery-requested states are not presented as confirmed WhatsApp delivery.
8. Board updates reconcile cards without reloading; moves animate and failed moves recover. Conditional status updates reject stale moves.
9. Task details and editing use a drawer with a full-page fallback, keyboard dismissal, and focus restoration.
10. Mobile navigation, stacked Board stages, accessible Move controls, a reachable setup Save bar, and reduced-motion alternatives.

The existing Browser addition was preserved. Friday runtime source, secrets, agent permissions, and schedules were not changed by this release. A cleared Cabinet recipient selection is now rejected instead of becoming an all-agent broadcast.

## Verification

- 16 Node/JSDOM checks passed, covering scripts/escaping, authentication proxy behaviour, draft preservation, guided completion, undo, modal editing/focus, cancelled confirmations, and failed task moves.
- Browser checks against the isolated fixture at desktop and 390px phone widths covered the shared shell, completing all three setup questions, the task drawer and Escape return, and an advisor response appearing alongside its request.
- Production container runtime checked seven source entry modules and rendered the Board successfully.
- Authenticated production GET checks returned 200 for health, Board, Cabinet, Setup, Activity, Schedule, System, Browser, live runs, one real advisor's overview/configure/onboard/runs pages, and one real task panel. Setup contained 16 groups and 36 questions. Ten embedded scripts compiled. Unauthenticated Cabinet access returned 401.
- The public authenticated Cabinet URL returned 200 and contained the new shared navigation. The in-app browser could not load that hostname; visual verification used the isolated local fixture.
- Production mutation testing was not performed; interactive mutation checks used disposable local fixture data.

## Release receipt

- Service: `app-reboot-solid-state-microchip-otrphm`
- Image: `voiceboard:ux-20260914-0650`
- Image ID: `sha256:2d88968fcae481f3241a3b92147d3e4d9f2218536bc8b6dbcfba809b015e0e86`
- Source archive: `/tmp/voiceboard-ux-20260914-0650.tgz` on m4 and the NAS.
- Archive SHA-256: `593b81c814f624302847f43570b0baed7e625395bd897352f4a78516c0bffe1e`
- Swarm update completed with one replica and stop-first update/rollback ordering.
- Previous functional release: `voiceboard:browser-20260913`.
- Deployment uses the working-tree source snapshot, including the previously existing Browser page. Changes remain available in the local working tree; no unrelated Friday runtime edits were committed.

Packaging strips macOS AppleDouble metadata from the source tree. The initial candidate included this metadata; the final image above passed the runtime checks after cleanup.

For future local checks, `node scripts/dev-preview.mjs` starts an isolated Board fixture on port 3137 and a fixture API on 3138. It never contacts production services. The preview username and password are both `preview`.
