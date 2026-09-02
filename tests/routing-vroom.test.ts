import { describe, it, expect } from "vitest";
import { buildVroomJob, applyVroomSolution, greedyAssign, type RoutableDelivery, type RoutableVehicle } from "@/lib/routing/vroom";

const depot = { lat: 35.7, lng: 51.4 };

function delivery(id: number, lat: number, lng: number, extra: Partial<RoutableDelivery> = {}): RoutableDelivery {
  return { delivery_id: id, lat, lng, weight_kg: 10, volume_m3: 0.1, service_min: 5, ...extra };
}
function vehicle(key: number, maxStops = 20): RoutableVehicle {
  return { vehicle_key: key, start: depot, end: depot, capacity: [1000, 5000, maxStops] };
}

describe("buildVroomJob", () => {
  it("puts kg, m³×100 and 1 in each job amount and the capacity triple on the vehicle", () => {
    const job = buildVroomJob(
      [delivery(1, 35.71, 51.41, { weight_kg: 40, volume_m3: 0.5 })],
      [vehicle(9, 15)],
      { durations: [[0, 600], [600, 0]] }
    );
    expect(job.jobs[0].amount).toEqual([40, 50, 1]);
    expect(job.jobs[0].location_index).toBe(1);
    expect(job.vehicles[0].capacity).toEqual([1000, 5000, 15]);
    expect(job.vehicles[0].start_index).toBe(0);
  });

  it("marks a cold-chain job and a refrigerated vehicle with the skill", () => {
    const job = buildVroomJob(
      [delivery(1, 35.71, 51.41, { needs_refrigeration: true })],
      [{ ...vehicle(9), has_refrigeration: true }],
      { durations: [[0, 1], [1, 0]] }
    );
    expect(job.jobs[0].skills).toEqual([1]);
    expect(job.vehicles[0].skills).toEqual([1]);
  });
});

describe("applyVroomSolution", () => {
  it("turns a 2-route response into ordered assignments with rising ETA and carries unassigned", () => {
    const res = applyVroomSolution({
      routes: [
        {
          vehicle: 9,
          distance: 12000,
          duration: 3000,
          steps: [
            { type: "start" },
            { type: "job", job: 1, arrival: 600 },
            { type: "job", job: 2, arrival: 1500 },
            { type: "end" },
          ],
        },
        {
          vehicle: 10,
          distance: 4000,
          duration: 900,
          steps: [{ type: "start" }, { type: "job", job: 3, arrival: 400 }, { type: "end" }],
        },
      ],
      unassigned: [{ id: 4 }],
    });
    expect(res.assignments[0].stops.map((s) => s.delivery_id)).toEqual([1, 2]);
    expect(res.assignments[0].stops[0].eta_min).toBeLessThan(res.assignments[0].stops[1].eta_min);
    expect(res.assignments[0].distance_km).toBe(12);
    expect(res.assignments[1].vehicle_key).toBe(10);
    expect(res.unassigned).toEqual([4]);
  });
});

describe("greedyAssign", () => {
  it("orders deliveries nearest-first from the depot and drops the overflow", () => {
    const ds = [
      delivery(1, 35.705, 51.405),
      delivery(2, 35.72, 51.42),
      delivery(3, 35.75, 51.45),
      delivery(4, 35.8, 51.5),
      delivery(5, 35.9, 51.6),
    ];
    const res = greedyAssign(ds, [vehicle(9, 4)]);
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].stops).toHaveLength(4);
    expect(res.assignments[0].stops[0].delivery_id).toBe(1); // closest to the depot
    expect(res.assignments[0].distance_km).toBeGreaterThan(0);
    expect(res.unassigned).toEqual([5]);
  });

  it("respects a weight cap", () => {
    const ds = [delivery(1, 35.71, 51.41, { weight_kg: 600 }), delivery(2, 35.72, 51.42, { weight_kg: 600 })];
    const v: RoutableVehicle = { vehicle_key: 1, start: depot, end: depot, capacity: [1000, 9999, 10] };
    const res = greedyAssign(ds, [v]);
    expect(res.assignments[0].stops).toHaveLength(1);
    expect(res.unassigned).toHaveLength(1);
  });
});
