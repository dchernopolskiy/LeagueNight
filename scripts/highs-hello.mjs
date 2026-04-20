import highsLoader from "highs";

const highs = await highsLoader();

const lp = `
Maximize
  obj: 10 x + 6 y + 4 z
Subject To
  c1: x + y + z <= 100
  c2: 10 x + 4 y + 5 z <= 600
  c3: 2 x + 2 y + 6 z <= 300
Bounds
  0 <= x
  0 <= y
  0 <= z
End
`;

const result = highs.solve(lp);
console.log("status:", result.Status);
console.log("objective:", result.ObjectiveValue);
console.log("columns:", result.Columns);
