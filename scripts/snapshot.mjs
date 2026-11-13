// Freezes real market data into data/snapshot.json for the offline demo.
// Run: npm run snapshot   (Node >= 22 strips the TS types in lib/market.ts)
import { writeFileSync } from "node:fs";
import { fetchMarket } from "../lib/market.ts";

const data = await fetchMarket(730);
data.source = "snapshot";
writeFileSync(new URL("../data/snapshot.json", import.meta.url), JSON.stringify(data));
console.log(`snapshot: ${data.dates.length} days, ${data.dates[0]} -> ${data.dates.at(-1)}`);
