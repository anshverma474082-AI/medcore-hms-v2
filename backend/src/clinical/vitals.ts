export function calculateBmi(weightKg?: number, heightCm?: number) {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return undefined;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Number.isFinite(bmi) ? Math.round(bmi * 100) / 100 : undefined;
}
