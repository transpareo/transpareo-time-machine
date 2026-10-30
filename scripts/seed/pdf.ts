/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A one-page PDF saying one line of text, the smallest file a
 * PDF viewer opens. It stands in for a certificate or a manual
 * in the demo passports, so the repo carries no binary for
 * them and the bytes, hence their digest, are the same on
 * every seed run.
 */

// Helvetica is one of the fonts every PDF reader carries, so
// the file embeds none. WinAnsiEncoding reads one byte per
// character, which is why the text must be Latin-1.
// The length is in characters, which are bytes here.
const objectsFor = (stream: string): string[] => [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
    + '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
    + '/Encoding /WinAnsiEncoding >>',
];

// Every object's byte offset is counted as the file is
// written, so the cross-reference table a reader seeks
// through is exact.
export function onePagePdf(text: string): Buffer {
  const line = text.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = objectsFor(`BT /F1 16 Tf 72 760 Td (${line}) Tj ET`);
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n';
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  const entries = offsets
    .map((at) => `${String(at).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
