// src/lib/utils.ts
import type { FoodItem } from './types';

/**
 * Calculates the estimated kilocalories for a food item based on macronutrients,
 * applying Thermic Effect of Food (TEF) adjusted values.
 * Treats null nutrient values as 0.
 *
 * Formula:
 * kcal = (protein * 3) + ((carbs - fibers) * 3.7) + (fibers * 2) + (fat * 9)
 *
 * @param item - An object containing nutrient values (can be Partial<FoodItem> or similar).
 * @returns The calculated kcal value, rounded to the nearest whole number. Returns 0 if essential values are missing/invalid.
 */
export function calculateKcal(item: {
  protein?: number | null; // Make optional
  fat?: number | null;     // Make optional
  carbs?: number | null;   // Make optional
  fibers?: number | null;  // Make optional
}): number {
  const protein = item.protein ?? 0;
  const fat = item.fat ?? 0;
  const carbs = item.carbs ?? 0;
  const fibers = item.fibers ?? 0;

  // Ensure digestible carbs are not negative if fibers > carbs (potential data error)
  const digestibleCarbs = Math.max(0, carbs - fibers);

  // Basic check if we have enough data to calculate
  if (protein === 0 && fat === 0 && carbs === 0 && fibers === 0) {
    return 0;
  }

  const kcal = protein * 3 + digestibleCarbs * 3.7 + fibers * 2 + fat * 9;

  return Math.round(kcal);
}

/**
 * Formats a date string or Date object into 'YYYY-MM-DD HH:mm' format using the local timezone.
 * @param dateInput - The date string or Date object.
 * @returns The formatted date string, or an empty string if input is invalid.
 */
export function formatLocalDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return ''; // Invalid date check

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (error) {
    console.error("Error formatting date:", error);
    return '';
  }
}

/**
* Formats a date string or Date object for display, showing 'Today', 'Yesterday', or 'YYYY-MM-DD'.
* @param dateInput - The date string or Date object.
* @returns The formatted display string.
*/
export function formatDisplayDate(dateInput: string | Date | null | undefined): string {
    if (!dateInput) return '';
    try {
        const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        if (isNaN(date.getTime())) return ''; // Invalid date check

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize today to midnight

        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1); // Normalize yesterday to midnight

        const inputDateOnly = new Date(date);
        inputDateOnly.setHours(0, 0, 0, 0); // Normalize input date to midnight

        if (inputDateOnly.getTime() === today.getTime()) {
            return 'Today';
        } else if (inputDateOnly.getTime() === yesterday.getTime()) {
            return 'Yesterday';
        } else {
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    } catch (error) {
        console.error("Error formatting display date:", error);
        return '';
    }
}

/**
 * Rounds a number to a specified number of decimal places.
 * @param value The number to round.
 * @param decimals The number of decimal places to round to.
 * @returns The rounded number.
 */
export function round(value: number, decimals: number): number {
  if (isNaN(value) || !isFinite(value)) return value; // Return as is if not a finite number
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Calculates and formats the Omega-6 to Omega-3 ratio as a string 'N : 1'.
 * Returns undefined if inputs are invalid, null, undefined, or if Omega-3 is zero.
 * @param n6 Omega-6 value (grams).
 * @param n3 Omega-3 value (grams).
 * @returns The formatted ratio string (e.g., "4.2 : 1") or undefined.
 */
export function ratio(n6: number | null | undefined, n3: number | null | undefined): string | undefined {
    // Check for null, undefined, non-finite numbers, or n3 being zero
    if (n6 == null || n3 == null || !isFinite(n6) || !isFinite(n3) || n3 === 0) {
        return undefined;
    }
    // Calculate ratio, round Omega-6 part to one decimal place
    const calculatedRatio = round(n6 / n3, 1);
    // Format using non-breaking space
    return `${calculatedRatio}\u00A0:\u00A01`;
}
