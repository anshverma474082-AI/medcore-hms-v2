import { calculateBmi } from './vitals';

describe('BMI calculation', () => {
  it('calculates BMI from kilograms and centimeters to two decimal places', () => {
    expect(calculateBmi(68, 172)).toBe(22.99);
  });

  it('omits BMI when either measurement is missing or invalid', () => {
    expect(calculateBmi()).toBeUndefined();
    expect(calculateBmi(68)).toBeUndefined();
    expect(calculateBmi(0, 172)).toBeUndefined();
    expect(calculateBmi(68, 0)).toBeUndefined();
  });
});
