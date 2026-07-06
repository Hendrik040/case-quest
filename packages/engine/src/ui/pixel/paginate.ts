/** Word-wrap text into pages of `lines` rows × `cols` chars (Gen-3 message box). */
export function paginate(text: string, cols: number, lines: number): string[][] {
  cols = Math.max(1, Math.floor(cols));
  lines = Math.max(1, Math.floor(lines));
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const rows: string[] = [];
  let current = "";
  const pushRow = () => { rows.push(current); current = ""; };
  for (let word of words) {
    while (word.length > cols) {
      if (current) pushRow();
      rows.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= cols) current += " " + word;
    else { pushRow(); current = word; }
  }
  if (current || rows.length === 0) pushRow();
  const pages: string[][] = [];
  for (let i = 0; i < rows.length; i += lines) pages.push(rows.slice(i, i + lines));
  return pages;
}
