/** Optional development oracle. Production generation has no Python dependency. */
import { readFile } from "node:fs/promises";
import type { ReportCatalog } from "../src/lib/reports";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  readData,
  variants,
  extract,
  cleanRows,
  assignGroups,
  normalize,
} from "./data";
import { distribution } from "../src/lib/insights/statistics";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const synthetic = [
  {
    id: 1,
    price: "1000000",
    bedrooms: null,
    size: null,
    kind: "Townhouse",
    date: "2026-10-01",
  },
  {
    id: 2,
    price: "0x100000",
    bedrooms: 2,
    size: 100,
    kind: "House",
    date: "2026-10-01",
  },
  {
    id: 3,
    price: "10000",
    bedrooms: 0,
    size: 4,
    kind: "House",
    date: "2026-10-01",
  },
  {
    id: 3,
    price: "20000",
    bedrooms: 101,
    size: 100,
    kind: "House",
    date: "2026-10-02",
  },
].map((value) => ({
  id: value.id,
  bedrooms: 5,
  size: 999,
  ratesAndTaxes: 0,
  jsonld: [
    {
      "@graph": [
        {
          datePosted: value.date,
          about: {
            "@type": value.kind === "Townhouse" ? "Apartment" : "House",
            description: value.kind,
            numberOfBedrooms: value.bedrooms,
            numberOfBathroomsTotal: 2,
            floorSize: { value: value.size },
            address: { streetAddress: "1 Straße ﬃ" },
          },
          breadcrumb: {
            itemListElement: [
              { position: 2, name: "KwaZulu-Natal" },
              { position: 3, name: "Straße ﬃ ς" },
              { position: 4, name: "Test" },
            ],
          },
          offers: { priceSpecification: { price: value.price } },
          description: "Fixture",
          image: "",
        },
      ],
    },
  ],
}));
const python = String.raw`
import json,sys,numpy as np
sys.path.insert(0, 'packages/model/src')
from property_model.train.data import read_listings,clean_listings,property_groups,extract_listing
raw,source,labels=read_listings('data/raw')
f,audit=clean_listings(raw)
f['group']=property_groups(f)
f=f.replace({np.nan:None})
signature=f[['id','price','province','city','suburb','bedrooms','bathrooms','floor_size','rates','group']].values.tolist()
c=f[f.date.between('2026-07-24','2026-10-21')].copy()
keys=['image','province','city','suburb','property_type','bedrooms','bathrooms','floor_size']
image=c[c.image.ne('')].sort_values(['date','id']).drop_duplicates(keys)
import pandas as pd
image=pd.concat([c[c.image.eq('')],image])
group=c.sort_values(['date','id']).drop_duplicates('group')
def summary(d):
 p=d.price.astype(float)
 return dict(count=len(d),p25=p.quantile(.25),median=p.median(),p75=p.quantile(.75))
checks={}
for name,d in [('baseline',c),('image',image),('group',group),('guard',c[c.price.between(100_000,50_000_000)]),('30d',f[f.date.between('2026-09-22','2026-10-21')]),('60d',f[f.date.between('2026-08-23','2026-10-21')]),('180d',f[f.date.between('2026-04-25','2026-10-21')])]:
 checks[name]={}
 for city,suburb,kind,beds in [('pretoria','pretoria north','House',3),('pretoria','montana','House',3),('pretoria','montana','Townhouse',3),('durban','bluff','House',3),('cape town','cape town city centre','Apartment / Flat',2)]:
  s=d[(d.city==city)&(d.suburb==suburb)&(d.property_type==kind)&(d.bedrooms==beds)]
  checks[name]['|'.join([city,suburb,kind,str(beds)])]=summary(s)
tails={}
for (province,city,kind,beds),d in c.groupby(['province','city','property_type','bedrooms']):
 if beds != int(beds):
  continue
 tails['|'.join([province,city,kind,str(int(beds))])] = [float(d.price.quantile(.05)),float(d.price.quantile(.95))]
synthetic_records=json.load(sys.stdin)
synthetic_raw=pd.DataFrame([extract_listing(r, '2026-10-01') for r in synthetic_records])
synthetic_clean,synthetic_audit=clean_listings(synthetic_raw)
synthetic_clean['group']=property_groups(synthetic_clean)
synthetic_clean=synthetic_clean.replace({np.nan:None})
synthetic_signature=synthetic_clean[['id','price','province','city','suburb','bedrooms','bathrooms','floor_size','rates','group']].values.tolist()
print(json.dumps(dict(tails=tails,synthetic_audit=synthetic_audit,synthetic_signature=synthetic_signature,source=source,audit=audit,signature=signature,variants=dict(baseline=len(c),image=len(image),group=len(group)),checks=checks)))
`;
const result = spawnSync(
  resolve(root, "packages/model/.venv/bin/python"),
  ["-c", python],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    input: JSON.stringify(synthetic),
  },
);
if (result.status !== 0) {
  throw Error(result.stderr || "Python oracle failed");
}
const expected = JSON.parse(result.stdout);
const syntheticResult = cleanRows(
  synthetic.map((record) => extract(record, "2026-10-01")),
);
assert.deepEqual(syntheticResult.audit, expected.synthetic_audit);
assert.deepEqual(
  assignGroups(syntheticResult.rows).map((r) => [
    r.id,
    r.price,
    r.province,
    r.city,
    r.suburb,
    r.bedrooms,
    r.bathrooms,
    r.floor_size,
    r.rates,
    r.group,
  ]),
  expected.synthetic_signature,
);
const actual = await readData(resolve(root, "data/raw"));
assert.deepEqual(actual.audit, expected.audit);
assert.equal(actual.source.raw_sha256, expected.source.raw_sha256);
assert.deepEqual(
  actual.rows.map((r) => [
    r.id,
    r.price,
    r.province,
    r.city,
    r.suburb,
    r.bedrooms,
    r.bathrooms,
    r.floor_size,
    r.rates,
    r.group,
  ]),
  expected.signature,
);
const sets = variants(
  actual.rows.filter((r) => r.date >= "2026-07-24" && r.date <= "2026-10-21"),
);
assert.deepEqual(
  Object.fromEntries(
    Object.entries(sets).map(([key, rows]) => [key, rows.length]),
  ),
  expected.variants,
);
const checkSets = {
  ...sets,
  guard: sets.baseline.filter(
    (row) => row.price >= 100_000 && row.price <= 50_000_000,
  ),
  "30d": actual.rows.filter(
    (row) => row.date >= "2026-09-22" && row.date <= "2026-10-21",
  ),
  "60d": actual.rows.filter(
    (row) => row.date >= "2026-08-23" && row.date <= "2026-10-21",
  ),
  "180d": actual.rows.filter(
    (row) => row.date >= "2026-04-25" && row.date <= "2026-10-21",
  ),
};
for (const [variant, rows] of Object.entries(checkSets)) {
  for (const [key, value] of Object.entries(expected.checks[variant])) {
    const [city, suburb, kind, beds] = key.split("|");
    const { prices, ...summary } = distribution(
      rows
        .filter(
          (r) =>
            r.city === city &&
            r.suburb === suburb &&
            r.property_type === kind &&
            r.bedrooms === Number(beds),
        )
        .map((r) => r.price),
    );
    void prices;
    assert.deepEqual(summary, value);
  }
}
const reports = JSON.parse(
  await readFile(
    resolve(root, "packages/website/.generated/reports.json"),
    "utf8",
  ),
) as ReportCatalog;
assert.equal(reports.provenance.rawSha256, expected.source.raw_sha256);
assert.equal(reports.provenance.asOf, "2026-10-21");
assert.equal(reports.provenance.windowStart, "2026-07-24");
const propertyLabels = {
  house: "House",
  flat: "Apartment / Flat",
  townhouse: "Townhouse",
};
let tailChecks = 0;
for (const city of reports.cities) {
  for (const row of city.rows) {
    if (row.evidence !== "supported") {
      assert.deepEqual(
        [row.p5, row.p25, row.median, row.p75, row.p95],
        [null, null, null, null, null],
      );
      continue;
    }
    const key = [
      normalize(city.provinceName),
      normalize(city.name),
      propertyLabels[row.type],
      row.bedrooms,
    ].join("|");
    const tails: number[] | undefined = expected.tails[key];
    assert.ok(tails, key);
    for (const [index, actualTail] of [row.p5, row.p95].entries()) {
      assert.notEqual(actualTail, null, key);
      assert.ok(
        Math.abs(actualTail! - tails[index]) <=
          Math.max(1e-7, Math.abs(tails[index]) * 1e-12),
        key,
      );
      tailChecks++;
    }
  }
}
console.log(
  `Python P5/P95 parity passed: ${tailChecks} published tail quantiles across ${reports.cities.length} city reports.`,
);
console.log(
  `Python parity passed: ${actual.rows.length} cleaned rows, full private row/group signature, SHA256, all duplicate/price-guard/window variants, reference quantiles and synthetic extraction/coercion/Unicode fixtures.`,
);
