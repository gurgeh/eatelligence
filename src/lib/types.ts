export type ServingUnit = 'g' | 'dl' | 'pcs' | 'portion';

export interface FoodItem {
	id: number;
	user_id?: string;
	name: string;
	serving_unit?: ServingUnit | null;
	serving_qty?: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
	fibers: number | null;
	sugar: number | null;
	mufa: number | null;
	pufa: number | null;
	sfa: number | null;
	gl: number | null;
	omega3: number | null;
	omega6: number | null;
	comment?: string | null;
	created_at?: string;
}

export interface FoodLog {
	id: number;
	user_id?: string;
	food_item_id: number;
	logged_at: string;
	multiplier: number;
	created_at?: string;
	food_items: FoodItem | null;
}

export interface NutritionTarget {
	id: string;
	user_id?: string;
	nutrient_1: string;
	nutrient_2: string | null;
	min_value: number | null;
	max_value: number | null;
}
