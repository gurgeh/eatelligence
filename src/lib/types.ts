// Define shared types for the application

export interface FoodItem {
  id: number;
  name: string;
  serving_unit: string; // e.g., '100g', '1 dl', '1 portion'
  serving_qty: number; // e.g., 100, 1, 1
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fibers: number | null;
  sugar: number | null;
  mufa: number | null; // Monounsaturated Fatty Acids
  pufa: number | null; // Polyunsaturated Fatty Acids
  sfa: number | null;  // Saturated Fatty Acids
  gl: number | null;   // Glycemic Load
  comment: string | null;
  created_at: string;
  // Add other fields if they exist (e.g., omega_3, omega_6, dii later)
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
