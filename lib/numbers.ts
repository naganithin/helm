// Typed or dictated amounts often arrive as words ("five hundred dollars", "six months"): turn them into digits.

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6 };
const word = (w: string) => w.toLowerCase().replace(/[.,!?]+$/, "");
const isNum = (w: string) => word(w) in ONES || word(w) in SCALE;

/** "two thousand five hundred" becomes "2500", "six months" becomes "6 months". Speech engines often spell numbers out. */
export function wordsToDigits(text: string): string {
  const t = text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi, "$1 $2");
  const parts = t.split(/(\s+)/); // words and the whitespace between them
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i] || /^\s+$/.test(parts[i]) || !isNum(parts[i])) { out.push(parts[i]); continue; }
    let total = 0, cur = 0, seenScale = false, last = i;
    for (let j = i; j < parts.length; j += 2) {
      const w = parts[j];
      if (isNum(w)) {
        const k = word(w);
        if (k in ONES) cur += ONES[k];
        else if (k === "hundred") cur = (cur || 1) * 100;
        else { total += (cur || 1) * SCALE[k]; cur = 0; }
        if (k in SCALE) seenScale = true;
        last = j;
      } else if (word(w) === "and" && seenScale && parts[j + 2] && isNum(parts[j + 2])) {
        last = j;
      } else break;
    }
    const tail = parts[last].match(/[.,!?]+$/)?.[0] ?? "";
    out.push(String(total + cur) + tail);
    i = last;
  }
  return out.join("");
}
