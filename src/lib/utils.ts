export function calculateKcal(item: {
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
  fibers?: number | null;
}): number {
  const protein = item.protein ?? 0;
  const fat = item.fat ?? 0;
  const carbs = item.carbs ?? 0;
  const fibers = item.fibers ?? 0;

  if (protein === 0 && fat === 0 && carbs === 0 && fibers === 0) {
    return 0;
  }

  const kcal = protein * 3 + carbs * 3.7 + fibers * 2 + fat * 9;
  return Math.round(kcal);
}

export function round(value: number, decimals: number): number {
  if (isNaN(value) || !isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function ratio(n6: number | null | undefined, n3: number | null | undefined): string | undefined {
  if (n6 == null || n3 == null || !isFinite(n6) || !isFinite(n3) || n3 === 0) {
    return undefined;
  }
  return `${round(n6 / n3, 1)} : 1`;
}

export const NUTRIENT_KEYS = [
  'protein', 'fat', 'carbs', 'fibers', 'sugar',
  'mufa', 'pufa', 'sfa', 'gl', 'omega3', 'omega6',
] as const;

export type NutrientKey = typeof NUTRIENT_KEYS[number];

export const relativeTargetMappings: { [key: string]: { label: string; n1: string; n2: string } } = {
  protein_percent_calories: { label: 'Protein (% of Calories)', n1: 'protein', n2: 'calories' },
  fat_percent_calories: { label: 'Fat (% of Calories)', n1: 'fat', n2: 'calories' },
  carbs_percent_calories: { label: 'Carbs (% of Calories)', n1: 'carbs', n2: 'calories' },
  omega6_omega3_ratio: { label: 'Omega-6 / Omega-3 Ratio (%)', n1: 'omega6', n2: 'omega3' },
  pufa_sfa_ratio: { label: 'PUFA / SFA Ratio (%)', n1: 'pufa', n2: 'sfa' },
  mufa_percent_fat: { label: 'MUFA (% of Total Fat)', n1: 'mufa', n2: 'fat' },
  pufa_percent_fat: { label: 'PUFA (% of Total Fat)', n1: 'pufa', n2: 'fat' },
  sfa_percent_fat: { label: 'SFA (% of Total Fat)', n1: 'sfa', n2: 'fat' },
};

export function generateTargetLabel(n1: string, n2: string | null): string {
  if (n2 === null) {
    const unit = n1 === 'calories' ? 'kcal' : 'g';
    return `${n1.charAt(0).toUpperCase() + n1.slice(1)} (${unit})`;
  }
  const mappingKey = Object.keys(relativeTargetMappings).find(
    (key) => relativeTargetMappings[key].n1 === n1 && relativeTargetMappings[key].n2 === n2
  );
  return mappingKey ? relativeTargetMappings[mappingKey].label : `${n1} / ${n2} (%)`;
}
