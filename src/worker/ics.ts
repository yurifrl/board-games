/**
 * Minimal iCalendar (RFC 5545) VEVENT parser — enough for a Google Calendar
 * private ICS feed. Handles line unfolding, DTSTART/DTEND (date + date-time,
 * with or without TZID), SUMMARY, DESCRIPTION, LOCATION, UID. Not a full parser.
 */
export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO
  end: string; // ISO
};

/** Unfold folded lines: a leading space/tab continues the previous line. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Parse an ICS date/date-time value to ISO. Supports `20260115`, `20260115T190000`, `...Z`. */
function toIso(value: string): string {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return value;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (!m[4]) return new Date(Date.UTC(+y, +mo - 1, +d)).toISOString(); // all-day
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  // Floating/TZID local time: treat as local wall time.
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
}

export function parseIcs(raw: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfold(raw)) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && cur.end && cur.summary != null) {
        events.push(cur as IcsEvent);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const prop = name.split(";")[0].toUpperCase();
    if (prop === "UID") cur.uid = value;
    else if (prop === "SUMMARY") cur.summary = unescape(value);
    else if (prop === "DESCRIPTION") cur.description = unescape(value);
    else if (prop === "LOCATION") cur.location = unescape(value);
    else if (prop === "DTSTART") cur.start = toIso(value);
    else if (prop === "DTEND") cur.end = toIso(value);
  }
  return events;
}

// Self-check: `bun run src/worker/ics.ts`
if (import.meta.main) {
  const sample = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:abc123",
    "SUMMARY:Wingspan [6]",
    "DESCRIPTION:Bring snacks\\nStarts sharp",
    "LOCATION:My place",
    "DTSTART:20260115T190000Z",
    "DTEND:20260115T220000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:def456",
    "SUMMARY:Open game night",
    "DTSTART;VALUE=DATE:20260120",
    "DTEND;VALUE=DATE:20260121",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcs(sample);
  console.assert(ev.length === 2, "expected 2 events, got " + ev.length);
  console.assert(ev[0].summary === "Wingspan [6]", "summary: " + ev[0].summary);
  console.assert(ev[0].description === "Bring snacks\nStarts sharp", "desc: " + JSON.stringify(ev[0].description));
  console.assert(ev[0].start === "2026-01-15T19:00:00.000Z", "start: " + ev[0].start);
  console.assert(ev[1].summary === "Open game night", "summary2: " + ev[1].summary);
  console.log("ics.ts self-check OK:", ev.length, "events");
}
