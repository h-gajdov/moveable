# Testing

## Automated

| Layer | Location | What it covers |
|---|---|---|
| Pipeline | `data-pipeline/tests` (pytest, 62 tests) | Way classification and access rules, sidewalk schemes, width/incline/kerb parsing, surface classes, crossings (legacy and new schemes), barriers, missing-data handling, way splitting, kerb attachment rules, metric lengths, transliteration. Fixture: `tests/fixtures/mini.osm`. |
| Backend unit | `EdgeCostBuilderTest`, `InstructionBuilderTest` | SQL generation (NULL-safe hard constraints, DEM never hard, obstacle joins, region-code validation), preference merging, instruction legs/turns/crossings/stairs, obstacle relevance per need. |
| Backend integration | `RoutingIntegrationTest`, `ApiIntegrationTest` (Testcontainers, `pgrouting/pgrouting:17-3.5-3.8.0`) | Deterministic fixture graph `src/test/resources/fixtures/graph.sql`: shortest path, wheelchair avoiding stairs, width limits, mapped vs estimated slopes, rough-surface penalties, raised kerbs, disconnected components, far-from-network points, snap warnings, verified vs pending obstacles, need-specific obstacle relevance, partial-edge routes, instructions, dedup of alternatives, validation, admin auth, moderation transitions and history, photo re-encoding and rejection, rate limiting, honeypot, Cyrillic/Latin search, coverage and map features. |
| Frontend unit | `frontend/src/**/*.test.ts(x)` (Vitest) | Translation completeness, name fallback, coordinates parsing, route projection, localized instructions, "unknown stays unknown", simple mode keeps safety notes, combobox keyboard semantics, no-route explanation. |
| End-to-end | `frontend/e2e` (Playwright + axe-core; desktop and Pixel 7 profiles) | See ACCESSIBILITY.md. Requires a running stack with imported data. |

## Manual accessibility test procedures

Run each with **real users with disabilities whenever possible**. Record
device, OS and AT versions, the language used, and any failure with steps to reproduce.

### Keyboard only (Windows/macOS, any browser)
1. Load `/`. The first Tab reaches "Skip to main content". Enter moves focus to the main content.
2. Tab through the header: the language buttons announce their pressed state, and the focus ring is visible on every control.
3. In "Start", type `plostad`. Arrow Down/Up moves through the options and Enter selects. Escape closes the list.
4. Type `41.9961, 21.4316` and select "Use coordinates".
5. Choose a profile with the arrow keys and open "Adjust needs" with Enter or Space.
6. Activate "Find route". Focus lands on the "Routes" heading.
7. Tab to "Start navigation". Use Next/Previous/Repeat, then "Stop navigation".
8. On `/report`, submit an empty form. Focus moves to the error summary.
9. With the map shown, "Choose on map" → Tab into the map → arrow keys pan → Enter chooses → Escape cancels.

### NVDA + Firefox/Chrome (Windows)
1. Browse mode, H key: one level-1 heading per page and a logical outline (h2 → h3 → h4 in results).
2. Landmarks (D): banner, navigation "Main", main, contentinfo.
3. Combobox: NVDA announces "combo box, collapsed/expanded", the result count is announced, and arrows read the active option.
4. After "Find route", NVDA reads the result announcement (count, distance, duration, suitability).
5. The steps list is announced as "list with N items", and each step reads "Step n of N".
6. Navigation: each step change is announced politely. Off-route and errors are announced assertively.
7. Switch the language to Macedonian. NVDA should switch voice if a Macedonian voice (e.g. eSpeak NG `mk`) is installed.

### JAWS (where available)
Repeat the NVDA steps. Pay particular attention to the combobox
(`aria-activedescendant`) and the live-region announcements.

### VoiceOver (macOS Safari, iOS Safari)
1. Rotor → Headings/Landmarks/Form controls show the expected structure.
2. iOS: swipe through the planner, double-tap to select a search result, and confirm that "Use my location" asks for permission only on activation.
3. Navigation page on iOS: Next/Previous are reachable without scrolling far. Test with speech on and off, and confirm VoiceOver and speech synthesis do not talk over each other badly.

### TalkBack (Android Chrome)
1. Explore by touch: all buttons have names, and the radio groups announce their legends.
2. Vibration: enable it in Settings → "Test vibration". In navigation, steps vibrate (crossings use a distinct pattern).
3. GPS: walk a short route outdoors. Turn announcements must stop when the accuracy warning is shown.

### Visual
1. 200 % and 400 % browser zoom at 1280 px width: no horizontal scrolling, nothing clipped.
2. Settings → text size 200 %, wide spacing, and each theme including high contrast. Windows High Contrast / forced colours keeps the route line visible.
3. Simulate protanopia/deuteranopia/tritanopia (DevTools). Routes stay distinguishable by line style and text.

### Field testing with disabled people
Recruit through local organisations (e.g. associations of wheelchair users and
of blind people). Pair each participant with a sighted or non-disabled
observer for safety. Compare suggested routes with reality and file every
mismatch as an obstacle report or an OSM fix. Never test crossings on the basis
of app data alone.
