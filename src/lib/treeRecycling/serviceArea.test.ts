import { describe, expect, it } from "vitest";
import { checkServiceArea } from "./serviceArea";

// [description, zip, latitude, longitude, expected in area]
const cases: [string, string, number, number, boolean][] = [
  // Full-coverage ZIP codes accept any location
  ["Hillsdale", "97239", 45.4795, -122.6975, true],
  ["Multnomah Village", "97219", 45.4655, -122.7115, true],
  ["Lake Grove", "97035", 45.4085, -122.7255, true],

  // 97201: south of US 26 and I-405 only
  ["Portland Heights", "97201", 45.508, -122.705, true],
  ["Goose Hollow", "97201", 45.519, -122.692, false],
  ["Downtown Portland", "97201", 45.519, -122.679, false],
  ["Portland State University", "97201", 45.511, -122.684, false],

  // 97221: south of US 26 only
  ["Bridlemile", "97221", 45.49, -122.73, true],
  ["Raleigh Hills", "97221", 45.4875, -122.7435, true],
  ["Sylvan Highlands", "97221", 45.515, -122.735, false],

  // 97034: north of Oswego Lake only
  ["Iron Mountain Park", "97034", 45.4135, -122.7, true],
  ["Country Club Road", "97034", 45.4195, -122.69, true],
  ["First Addition", "97034", 45.4185, -122.669, true],
  ["South Shore Boulevard", "97034", 45.404, -122.705, false],
  ["Lakeridge High School", "97034", 45.3965, -122.7, false],
  ["Palisades", "97034", 45.401, -122.688, false],

  // 97223: north of Highway 217 only
  ["Metzger", "97223", 45.4485, -122.76, true],
  ["Garden Home", "97223", 45.464, -122.759, true],
  ["Tigard Triangle", "97223", 45.438, -122.755, true],
  ["Downtown Tigard", "97223", 45.429, -122.772, false],
  ["Bull Mountain", "97223", 45.418, -122.801, false],
  ["Durham Road", "97223", 45.405, -122.77, false],

  // 97229: east of NW Saltzman Road, west of NW Skyline Boulevard, and south
  // of NW Thompson Road
  ["Forest Heights", "97229", 45.5438, -122.7749, true],
  ["Cedar Mill east of Saltzman", "97229", 45.5408, -122.8006, true],
  ["North of Thompson Road", "97229", 45.5558, -122.7835, false],
  ["East of Skyline Boulevard", "97229", 45.5408, -122.756, false],
  ["Skyline Boulevard north of Thompson", "97229", 45.565, -122.79, false],
  ["Cedar Mill (Cornell and 119th)", "97229", 45.528, -122.807, false],
  ["Bethany", "97229", 45.557, -122.837, false],

  // ZIP codes outside the service area
  ["Downtown Portland", "97204", 45.5185, -122.6775, false],
  ["Beaverton", "97005", 45.4875, -122.8035, false],
];

describe("checkServiceArea", () => {
  it.each(cases)("%s (%s)", (_name, zip, lat, lng, expected) => {
    expect(checkServiceArea(zip, lat, lng).inArea).toBe(expected);
  });

  it("explains the coverage of partial ZIP codes", () => {
    expect(checkServiceArea("97223", 45.418, -122.801).coverageNote).toBe(
      "north of Highway 217",
    );
  });

  it("uses only the first five digits of a ZIP+4", () => {
    expect(checkServiceArea("97219-1234", 45.4655, -122.7115).inArea).toBe(true);
  });
});
