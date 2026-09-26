/* File names that sort by date in a Downloads folder: "Sep26 ...".
 *
 * Month and two-digit day first, so a folder full of saved posts and titles
 * lines up in the order they were made; then what the file is; then the few
 * words that say which one. Only letters, digits, apostrophes and hyphens
 * survive from each word, which keeps out everything Windows refuses in a
 * file name. Pure, so it is tested at a desk.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function datePrefix(when: Date): string {
  return `${MONTHS[when.getMonth()]}${String(when.getDate()).padStart(2, "0")}`;
}

/** The words of `text`, cleaned for a file name, without the `skip` ones. */
export function nameWords(text: string, skip: Set<string>, max: number): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, "").replace(/^[-'’]+|[-'’]+$/g, ""))
    .filter((w) => w && !skip.has(w.toLowerCase()))
    .slice(0, max);
}

export function datedName(kind: string, words: string[], when: Date): string {
  return [datePrefix(when), kind, ...words].join(" ") + ".png";
}
