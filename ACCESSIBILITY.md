# Accessibility

Target: **WCAG 2.2 Level AA** for the whole application, plus routing that
reflects disabled people's real needs. This document records what is
implemented, how it is tested, and what is still open.

## Principles

1. **Unknown is not accessible.** Missing tags never make a path suitable, and
   never silently exclude it either. Every route lists what is not mapped.
2. **Requirements are never loosened silently.** If no route meets them, the
   user is told what blocks the way and decides what to change.
3. **The map is optional.** Everything works from search, typed coordinates,
   device location, text results and step lists. Map picking works by keyboard.
4. **No diagnosis is asked for.** Profiles describe needs ("I use a wheeled
   aid", "I need non-visual guidance"). Every setting can be combined and adjusted.
5. **No single channel.** Each instruction is shown as text, announced through
   live regions, optionally spoken, and optionally signalled by vibration.
   Nothing depends on hearing or on colour.

## Interface features

| Need | Implementation |
|---|---|
| Screen readers | Semantic landmarks, one `h1` per page, logical heading levels, labelled controls, `fieldset/legend` for groups, ARIA 1.2 combobox, polite/assertive live regions, focus moved to new content (route results, page changes, error summaries), steps as an ordered list with "Step n of N". |
| Keyboard / switch | Everything is reachable by Tab. Skip link. Visible two-tone focus ring (yellow + dark). No drag-only interactions. Map picking works with arrows + Enter, and Escape cancels. |
| Motor | Primary targets ≥ 44×44 CSS px, radios and checkboxes sized 24 px with full-row labels, no time limits, no gestures required. |
| Low vision | Text size 100–200 % (rem-based reflow), browser zoom, light/dark/high-contrast themes, `forced-colors` support, AA contrast in all themes (checked by axe), Fira Sans with full Cyrillic. |
| Colour vision | Routes use the Okabe–Ito palette **and** solid/dashed/dotted lines plus text ("Route 2, dashed line"). Statuses use shapes (✓ ! ?) and words. |
| Deaf / hard of hearing | No audio-only information. Speech is optional and always mirrored as text. Vibration patterns are optional. |
| Cognitive | Plain language, consistent layout, "short and simple" instruction mode that keeps safety notes, step-by-step navigation with Repeat/Next/Previous, error messages that say what to do. |
| Motion | `prefers-reduced-motion` respected, plus an explicit "Reduce animation" setting that also stops map fly animations. |
| Languages | Macedonian (Cyrillic), Albanian, English. The language switch is on every page, and `<html lang>` is updated. |

## Routing for needs

| Need | Hard constraints (edge removed) | Soft preferences |
|---|---|---|
| Wheeled mobility | stairs without a mapped ramp, kerbs mapped higher than the limit (`kerb=raised` without height, if limit < 10 cm), wheelchair-blocking barriers, `wheelchair=no`, impassable surface, mapped width below the limit, **mapped** incline above the limit | rough or unknown surface, estimated steep slopes, unknown kerbs at crossings, `wheelchair=limited`, data uncertainty |
| Non-visual guidance | none by default | traffic exposure, walking on the carriageway, crossings without signals / audible signal / tactile paving, complex junctions, data uncertainty |
| Reduced mobility | stairs, mapped steep slopes | distance, slopes, rough surfaces, missing benches |
| Custom | any combination of the above | any combination |

## Automated testing

* `frontend/e2e/accessibility.spec.ts`: axe-core (WCAG 2.0/2.1/2.2 A and AA
  tags) on every page, in dark and high-contrast themes, on desktop and on a
  mobile device profile. Also checks one `h1`, the skip link, landmarks,
  language switching, 200 % text reflow without horizontal scroll, and target sizes.
* `frontend/e2e/routing.spec.ts`: a complete keyboard-only journey in text-only
  mode against the real backend. Searches two real places, picks the wheelchair
  profile, finds the route, checks the not-guaranteed notice and steps, runs
  axe on the results, and steps through navigation manually.
* Vitest/Testing Library: combobox keyboard semantics, coordinates without the
  map, no-route explanation, translation completeness (mk/sq have every key).

Automated checks find perhaps a third of real barriers. They do **not**
replace testing with assistive technologies and disabled people. See
[docs/TESTING.md](docs/TESTING.md).

## Known gaps and open work

* **Not yet tested with real users** or with JAWS, NVDA, VoiceOver or TalkBack
  on real devices. The procedures are written; sessions with Skopje disability
  organisations are the next step.
* Macedonian and Albanian translations were written by the developers and need
  review by native speakers, ideally including Easy-Read variants.
* Speech synthesis voices for Macedonian and Albanian are missing on many
  devices. The app detects this and relies on screen readers and text.
* Map tiles come from a third-party style and their labels are not localised
  by the app. The map is supplementary.
* Route quality is limited by OSM data. Kerbs, widths and tactile paving are
  rarely mapped in Skopje (see DATA_SOURCES.md).
