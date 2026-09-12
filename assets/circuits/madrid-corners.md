# Madrid corner fallback

These annotations are approximate map-derived apex chainages, not surveyed coordinates.

Primary source: FIA, 2026 Spanish Grand Prix, Document 6, Circuit Map (page 2), version 3 issued 10 September 2026:
https://www.fia.com/system/files/decision-document/2026_spanish_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_and_emergency_exits_map.pdf

The map labels T1–T22 plus T5A and T20A. Circuit length is 5414 m; sectors are 1839, 2049 and 1526 m. S1 is 85 m before T7; S2 is 40 m before T16. Thus T7 and T16 anchor the annotations at 1924 m and 3928 m.

Turn locations were visually matched to vertices of the existing `es-2026` feature in f1-circuits.geojson. Longitude distances are corrected by cos(40.47 degrees), cumulative centreline distance is scaled to 5414 m, and the start offset is derived from the T7 anchor. A piecewise linear correction through T7, T16, and the finish fixes the remaining map discrepancy. Vertex indices (zero-based) for T1 onward: 2, 4, 8, 16, 22, 24 (T5A), 27, 37, 40, 43, 47, 50, 59, 71.5, 76, 82, 85, 88, 94, 99, 103.5, 105.5 (T20A), 107.5, 113. Fractional indices interpolate adjacent vertices.

The geometry predates the final FIA drawing, so local apex locations have unquantified uncertainty. Display text explicitly identifies this fallback as approximate. It does not change telemetry samples or lap timing. Native complete Madrid metadata takes priority when available. This fallback is scoped to Spanish Grand Prix sessions from 2026 onward; Barcelona is unaffected.
