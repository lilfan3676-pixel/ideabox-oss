// 大字的換行：標題要排兩行時，自己挑斷在哪裡，讓兩行差不多長，
// 不要第二行只剩一兩個字，也不要把英文單字、數字或括號切開。

/** 一個字大約佔幾個全形字寬 */
const unit = (ch: string) => (ch === " " ? 0.3 : /[\u0000-ÿ]/.test(ch) ? (/[A-Z0-9mwMW]/.test(ch) ? 0.62 : 0.52) : 1);
export const widthOf = (s: string) => [...s].reduce((n, ch) => n + unit(ch), 0);

const WORD = /[A-Za-z0-9.+%\-/]/; // 英文、數字連在一起不能切
const NO_START = /[，。、：；！？）」』】〉》,.:;!?)\]%]/; // 不能放在行首
const NO_END = /[（「『【〈《(\[]/; // 不能放在行尾
const GOOD_AFTER = /[，、：；。！？,:;　 ]/; // 斷在這些字後面最自然

/** cap＝一行放得下幾個全形字。放得下一行或超過兩行的不動（交給系統排） */
export function balance(text: string, cap: number): string {
  const t = text.trim();
  if (!t || t.includes("\n") || cap < 3) return t;
  const chars = [...t];
  const total = widthOf(t);
  if (total <= cap || total > cap * 2) return t;
  let best = -1;
  let bestScore = Infinity;
  let left = 0;
  for (let i = 1; i < chars.length; i++) {
    left += unit(chars[i - 1]);
    const a = chars[i - 1];
    const b = chars[i];
    if (left > cap || total - left > cap) continue;
    if ((WORD.test(a) && WORD.test(b)) || NO_START.test(b) || NO_END.test(a)) continue;
    // 越接近一半越好；斷在標點、空白後面或括號前面再加分
    let score = Math.abs(left - total / 2);
    if (GOOD_AFTER.test(a) || NO_END.test(b)) score -= 2;
    else if (WORD.test(a) !== WORD.test(b)) score -= 0.5; // 中文和英數交界
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return t;
  return `${chars.slice(0, best).join("").trimEnd()}\n${chars.slice(best).join("").trimStart()}`;
}
