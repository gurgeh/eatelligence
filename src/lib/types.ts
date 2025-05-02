// Define shared types for the application

export interface FoodItem {
  id: number;
  name: string;
  serving_unit: string; // e.g., '100g', '1 dl', '1 portion'
  serving_qty: number; // e.g., 100, 1, 1
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fibers: number | null;
  sugar: number | null;
  mufa: number | null; // Monounsaturated Fatty Acids
  pufa: number | null; // Polyunsaturated Fatty Acids
  sfa: number | null;  // Saturated Fatty Acids
  gl: number | null;   // Glycemic Load
  omega3: number | null; // Omega-3 Fatty Acids
  omega6: number | null; // Omega-6 Fatty Acids
  comment: string | null;
  created_at: string;
}

// Add other shared types here as needed, e.g., for FoodLog
export interface FoodLog {
    id: number;
    user_id: string; // Assuming authentication adds this later
    food_item_id: number;
    logged_at: string; // ISO 8601 timestamp
    multiplier: number;
    created_at: string;
    food_items: FoodItem; // For joined data
}

// Represents a nutrition target definition
export interface NutritionTarget {
	id: string; // uuid from Supabase
	nutrient_1: string; // The primary nutrient (e.g., 'protein', 'fat', 'omega6')
	nutrient_2: string | null; // The denominator nutrient for relative targets (e.g., 'calories', 'omega3'), null for absolute
	min_value: number | null; // Minimum target value (g/kcal or %)
	max_value: number | null; // Maximum target value (g/kcal or %)
}
