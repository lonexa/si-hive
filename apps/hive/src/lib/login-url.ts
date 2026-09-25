/**
 * Recover the OAuth sign-in URL from a login terminal's raw output.
 *
 * Needed because the Hive service runs as LocalSystem in session 0: the CLI
 * prints "Opening browser to sign in…" but cannot actually open a browser in
 * the user's desktop session, so the URL on screen is the only way in. And that
 * URL is unsafe to copy by hand — the PTY HARD-wraps it, inserting CRLF at the
 * terminal width, so a terminal selection carries line breaks into the address
 * bar and the mangled code_challenge/state makes the returned code fail the
 * exchange with a 400.
 *
 * The wrap never inserts spaces, so a following row continues the URL exactly
 * when the previous row was filled to the terminal width.
 */
const URL_START = 'https://claude.com/';

/** Strip CSI and OSC sequences; the URL itself contains no escapes. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

export function extractLoginUrl(buffer: string, cols = 100): string | null {
  const lines = stripAnsi(buffer).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(URL_START);
    if (at < 0) continue;

    let url = lines[i].slice(at);
    // Row width includes whatever preceded the URL on that line ("… visit: "),
    // since the wrap happens at the terminal column, not at the URL's start.
    let rowLength = lines[i].length;

    // Exactly cols, not >=: a hard wrap fills the row completely, so an
    // exact match is the only reliable signal that the URL continues. Using
    // >= would append the first word of whatever output followed the URL.
    for (let j = i + 1; j < lines.length && rowLength === cols; j++) {
      const next = lines[j];
      // A continuation row starts immediately with URL text. Anything that
      // begins with whitespace, or is empty, is new output rather than more URL.
      if (!next || /^\s/.test(next)) break;
      const token = next.split(/\s/)[0];
      if (!token) break;
      // A URL can also end exactly ON the wrap boundary, in which case the next
      // row is ordinary output ("Paste code here if prompted >") and must not be
      // appended. Query-string tails carry digits or punctuation, or are long
      // opaque values; a short all-letters word is prose, not more URL.
      if (/^[A-Za-z]{1,19}$/.test(token)) break;
      url += token;
      rowLength = next.length;
      // A row that is not full, or that contains a space, ended the URL.
      if (next.includes(' ')) break;
    }

    // Guard against returning a fragment if the output was captured mid-write.
    return url.length > 60 ? url : null;
  }
  return null;
}
