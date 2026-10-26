export type TextDirection = "ltr" | "rtl";

const RTL_LETTERS = /[֐-׿؀-ۿ]/;

// the Scouting App's rule - dir="auto" goes by the first letter and would read "L3 בכל משחק" left to right
export function textDirection(text: string): TextDirection {
  return RTL_LETTERS.test(text) ? "rtl" : "ltr";
}
