/** Same encoding as gpu/samutil.py rle_encode (row-major, starts with a false run). */
export function encodeRleForTest(mask: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let value = 0;
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === value) run++;
    else {
      runs.push(run);
      value = v;
      run = 1;
    }
  }
  runs.push(run);
  return runs;
}
