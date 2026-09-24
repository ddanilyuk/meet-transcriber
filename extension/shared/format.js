// Transcript export formats (Markdown, plain text, JSON) and download file names.
(function (root) {
  const MT = (root.MT = root.MT || {});
  const { formatTime, formatDate, formatDuration, groupTurns, pad2 } = MT.util;

  function speakersOf(meeting) {
    const fromEntries = [...new Set((meeting.entries || []).map((e) => e.speaker))];
    return fromEntries.length ? fromEntries : meeting.speakers || [];
  }

  function span(meeting) {
    const start = meeting.startedAt;
    const last = (meeting.entries || []).reduce((m, e) => Math.max(m, e.updatedAt || e.startedAt || 0), 0);
    const end = meeting.endedAt || last || meeting.updatedAt || start;
    return { start, end, text: `${formatDate(start)}, ${formatTime(start)}–${formatTime(end)} (${formatDuration(end - start)})` };
  }

  function title(meeting) {
    return meeting.title || meeting.code || 'Google Meet';
  }

  function toMarkdown(meeting) {
    const lines = [`# ${title(meeting)}`, ''];
    lines.push(`- **Дата:** ${span(meeting).text}`);
    if (meeting.code) lines.push(`- **Код мітингу:** ${meeting.code}`);
    const speakers = speakersOf(meeting);
    if (speakers.length) lines.push(`- **Учасники:** ${speakers.join(', ')}`);
    if (meeting.language) lines.push(`- **Мова субтитрів:** ${meeting.language}`);
    lines.push('', '---', '');
    for (const turn of groupTurns(meeting.entries || [])) {
      lines.push(`**${turn.speaker}** · ${formatTime(turn.startedAt, true)}`);
      turn.entries.forEach((e, i) => {
        if (i > 0) lines.push('');
        lines.push(e.text);
      });
      lines.push('');
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  function toText(meeting) {
    const lines = [title(meeting), span(meeting).text + (meeting.code ? ` · ${meeting.code}` : '')];
    const speakers = speakersOf(meeting);
    if (speakers.length) lines.push(`Учасники: ${speakers.join(', ')}`);
    lines.push('');
    for (const e of meeting.entries || []) lines.push(`[${formatTime(e.startedAt, true)}] ${e.speaker}: ${e.text}`);
    return lines.join('\n') + '\n';
  }

  function toJson(meeting) {
    const iso = (ts) => (ts ? new Date(ts).toISOString() : null);
    return JSON.stringify(
      {
        title: title(meeting),
        code: meeting.code || null,
        url: meeting.url || null,
        language: meeting.language || null,
        startedAt: iso(meeting.startedAt),
        endedAt: iso(meeting.endedAt),
        speakers: speakersOf(meeting),
        entries: (meeting.entries || []).map((e) => ({ speaker: e.speaker, text: e.text, startedAt: iso(e.startedAt) })),
      },
      null,
      2,
    ) + '\n';
  }

  const FORMATS = {
    md: { ext: 'md', mime: 'text/markdown', render: toMarkdown },
    txt: { ext: 'txt', mime: 'text/plain', render: toText },
    json: { ext: 'json', mime: 'application/json', render: toJson },
  };

  // "Meet Transcripts/2026-09-24 14-02 Щотижневий синк.md" — safe on macOS, Windows and Linux.
  function fileName(meeting, format = 'md', folder = 'Meet Transcripts') {
    const d = new Date(meeting.startedAt);
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
    const name = title(meeting)
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 80);
    const base = name ? `${stamp} ${name}` : stamp;
    return `${folder ? folder + '/' : ''}${base}.${FORMATS[format].ext}`;
  }

  function render(meeting, format = 'md') {
    const f = FORMATS[format];
    if (!f) throw new Error(`Unknown format: ${format}`);
    return { text: f.render(meeting), mime: f.mime, filename: fileName(meeting, format) };
  }

  MT.format = { toMarkdown, toText, toJson, fileName, render, FORMATS };
})(globalThis);
