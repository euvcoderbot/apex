# Sepang corner annotation fallback

The current session feed identifies the 2026 Bahrain GP venue as Kuala Lumpur,
Circuit Key 12. The event name must not resolve it to Sakhir (Circuit Key 63).

MultiViewer's circuit index does not contain key 12. The 15 turn numbers were
verified visually against page 3 of Sepang International Circuit's official
[Safety Briefing](https://www.sepangcircuit.com/media/wysiwyg/pdf/Daily_Safety_Briefing.pdf).
Turn 12 is the bend between turns 11 and 13; it is unlabeled in that drawing.
The bundled `my-1999` centreline supplies approximate positions. Zero-based
vertices: 6,14,24,35,44,52,57,60,66,71,78,83,89,94,100.
Fractions are cumulative centreline distance divided by total centreline length,
not percentages of lap time. These are annotation estimates, not surveyed GPS
or measurements of apex position. Native supplied corner markers take priority.
