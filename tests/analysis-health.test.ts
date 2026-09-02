import { describe, it, expect } from "vitest";
import {
  band,
  customerHealth,
  salespersonScore,
  driverScore,
  type CustomerHealthInput,
  type SalespersonScoreInput,
  type DriverScoreInput,
} from "@/lib/analysis/health";

const customer = (o: Partial<CustomerHealthInput>): CustomerHealthInput => ({
  days_since_last_order: 10,
  mean_interval_days: 14,
  orders_this_q: 12,
  orders_prev_q: 10,
  overdue_toman: 0,
  credit_limit_toman: 3_000_000,
  complaints_90d: 0,
  margin_pct: 0.3,
  ...o,
});

const sp = (o: Partial<SalespersonScoreInput>): SalespersonScoreInput => ({
  target_fraction: 1.1,
  active_customers: 10,
  assigned_customers: 10,
  sample_conversion: 0.4,
  overdue_ratio: 0,
  on_time_task_ratio: 1,
  ...o,
});

const drv = (o: Partial<DriverScoreInput>): DriverScoreInput => ({
  on_time_delivery: 1,
  fill_rate: 1,
  failed_ratio: 0,
  stops_per_hour: 5,
  ...o,
});

describe("analysis/health", () => {
  it("band cutpoints", () => {
    expect(band(70)).toBe("good");
    expect(band(69)).toBe("watch");
    expect(band(40)).toBe("watch");
    expect(band(39)).toBe("risk");
  });

  describe("customerHealth", () => {
    it("a healthy customer scores ≥ 90, good, no reasons", () => {
      const h = customerHealth(customer({}));
      expect(h.score).toBeGreaterThanOrEqual(90);
      expect(h.band).toBe("good");
      expect(h.reasons).toEqual([]);
    });

    it("a clear-risk customer is risk and names cadence first, then payment", () => {
      const h = customerHealth(
        customer({
          days_since_last_order: 90,
          mean_interval_days: 20,
          orders_this_q: 2,
          orders_prev_q: 10,
          overdue_toman: 3_000_000,
          complaints_90d: 1,
          margin_pct: 0.1,
        })
      );
      expect(h.band).toBe("risk");
      expect(h.reasons[0]).toBe("سفارش‌ها از ریتم همیشگی عقب افتاده");
      expect(h.reasons).toContain("بدهی معوق نزدیک سقف اعتبار");
    });

    it("never ordered → cadence 0, its own reason", () => {
      const h = customerHealth(customer({ days_since_last_order: null }));
      expect(h.reasons).toContain("هرگز سفارشی ثبت نکرده");
    });

    it("days_since = 3× mean interval → cadence pinned to 0", () => {
      const worse = customerHealth(customer({ days_since_last_order: 60, mean_interval_days: 20 }));
      const ok = customerHealth(customer({ days_since_last_order: 20, mean_interval_days: 20 }));
      expect(worse.score).toBeLessThan(ok.score);
      expect(worse.reasons).toContain("سفارش‌ها از ریتم همیشگی عقب افتاده");
    });

    it("prev quarter 0 does not divide by zero", () => {
      expect(() => customerHealth(customer({ orders_prev_q: 0, orders_this_q: 0 }))).not.toThrow();
      const grew = customerHealth(customer({ orders_prev_q: 0, orders_this_q: 4 }));
      expect(Number.isFinite(grew.score)).toBe(true);
    });
  });

  describe("salespersonScore", () => {
    it("a strong month scores ≥ 90, good", () => {
      const s = salespersonScore(sp({}));
      expect(s.score).toBeGreaterThanOrEqual(90);
      expect(s.band).toBe("good");
    });

    it("behind target + dead book → risk, target reason first", () => {
      const s = salespersonScore(
        sp({ target_fraction: 0.3, active_customers: 2, assigned_customers: 20, sample_conversion: 0, overdue_ratio: 0.5, on_time_task_ratio: 0.2 })
      );
      expect(s.band).toBe("risk");
      expect(s.reasons[0]).toBe("از هدف فروش ماه عقب است");
    });

    it("assigned_customers 0 is guarded", () => {
      expect(() => salespersonScore(sp({ assigned_customers: 0, active_customers: 0 }))).not.toThrow();
    });
  });

  describe("driverScore", () => {
    it("a clean day scores ≥ 90, good", () => {
      const d = driverScore(drv({}));
      expect(d.score).toBeGreaterThanOrEqual(90);
      expect(d.band).toBe("good");
    });

    it("stops_per_hour null drops that factor without NaN", () => {
      const d = driverScore(drv({ stops_per_hour: null }));
      expect(Number.isFinite(d.score)).toBe(true);
      expect(d.score).toBeGreaterThanOrEqual(90);
    });

    it("failures + slow → risk, failed-ratio reason first", () => {
      const d = driverScore(drv({ on_time_delivery: 0.5, fill_rate: 0.6, failed_ratio: 0.3, stops_per_hour: 1 }));
      expect(d.band).toBe("risk");
      expect(d.reasons[0]).toBe("نسبت تحویل ناموفق بالاست");
    });
  });
});
