import highsLoader from "highs";
const highs = await highsLoader();

// Same but with integer vars — pick up to 2 items, max value.
const lp = `
Maximize
  obj: 10 a + 6 b + 4 c
Subject To
  c1: a + b + c <= 2
Bounds
  0 <= a <= 1
  0 <= b <= 1
  0 <= c <= 1
General
  a b c
End
`;

const result = highs.solve(lp);
console.log("status:", result.Status);
console.log("objective:", result.ObjectiveValue);
for (const [k, v] of Object.entries(result.Columns)) {
  console.log(`  ${k} = ${v.Primal} (${v.Type})`);
}
