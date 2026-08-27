import { describe, expect, it } from 'vitest';

import { roadsideLayoutFor, roadsideRunAllows } from '../src/world/roadside-layout';

describe('roadside composition', () => {
  it('keeps vehicle silhouettes mutually exclusive on each selected run', () => {
    const cars = ['carSedan', 'carVan', 'carPickup'];
    let occupied = 0;
    for (let run = 0; run < 4096; run++) {
      const owners = cars.filter((key) => roadsideRunAllows(0x5ca77e, key, run));
      expect(owners.length).toBeLessThanOrEqual(1);
      if (owners.length > 0) occupied++;
    }
    expect(occupied / 4096).toBeGreaterThan(0.19);
    expect(occupied / 4096).toBeLessThan(0.25);
  });

  it('leaves most kerb runs free of repeated amenity props', () => {
    for (const key of ['bench', 'hedge', 'fence', 'telegraphPole']) {
      let selected = 0;
      for (let run = 0; run < 4096; run++) {
        if (roadsideRunAllows(0x91da7, key, run)) selected++;
      }
      expect(selected / 4096, key).toBeLessThan(0.17);
    }
  });

  it('uses block-scale spacing and small per-run caps', () => {
    const lamp = roadsideLayoutFor('streetLamp')!;
    const car = roadsideLayoutFor('carSedan')!;
    expect(lamp.pitchMin).toBeGreaterThanOrEqual(30);
    expect(car.pitchMin).toBeGreaterThanOrEqual(50);
    expect(car.maxPerRun).toBeLessThanOrEqual(2);
    expect(car.endClearance).toBeGreaterThanOrEqual(20);
  });
});
