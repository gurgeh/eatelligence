<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import type { FoodItem } from '$lib/types';
	import { onDestroy, onMount, tick } from 'svelte';
	import { GoogleGenAI, Type } from '@google/genai';
	import { ratio } from '$lib/utils';
	import Fuse, { type FuseResult } from 'fuse.js';
	import NutrientBadges from '$lib/components/NutrientBadges.svelte';
	import {
		clearGeminiKeyForUser,
		loadGeminiKeyForUser,
		saveGeminiKeyForUser,
		type GeminiKeyResult,
		type GeminiKeySource
	} from '$lib/geminiKey';
	import { Camera, ImagePlus, X } from 'lucide-svelte';

	function assert(condition: unknown, message: string): asserts condition {
		if (!condition) throw new Error(message);
	}

	function getErrorMessage(error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}

	type NutritionData = Pick<
		FoodItem,
		| 'protein'
		| 'fat'
		| 'carbs'
		| 'fibers'
		| 'sugar'
		| 'mufa'
		| 'pufa'
		| 'sfa'
		| 'gl'
		| 'omega3'
		| 'omega6'
	>;

	type ParsedIngredient = {
		name?: string;
		quantity?: number;
		unit?: 'g' | 'dl' | 'pcs' | 'portion' | string;
		id?: number;
		multiplier?: number;
	};

	function normalizeIngredientUnit(unit: ParsedIngredient['unit']): 'g' | 'dl' | 'pcs' | 'portion' {
		return unit === 'dl' || unit === 'pcs' || unit === 'portion' ? unit : 'g';
	}

	type IngredientResult = {
		id: number;
		multiplier: number;
		serving_qty: number;
		serving_unit: string;
		nutrition: NutritionData;
	};

	async function processSingleIngredient(
		genAI: GoogleGenAI,
		name: string,
		quantity: number,
		unit: string
	): Promise<IngredientResult> {
		const standardUnit =
			unit === 'dl' ? 'dl' : unit === 'pcs' ? 'pcs' : unit === 'portion' ? 'portion' : 'g';
		const standardQty = standardUnit === 'g' ? 100 : 1;
		const multiplier = quantity / standardQty;

		const prompt = `Provide nutritional information per ${standardQty} ${standardUnit} for the food item "${name}". For 'carbs', report carbohydrates excluding fiber. If sources do not provide a value, you MUST estimate it from best guess. If assumptions are needed, include only the most important ones in the 'comment' field prefixed with "Assumptions: ". Be brief. Do not include source references or citations.`;

		const result = await genAI.models.generateContent({
			model: 'gemini-3.5-flash',
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
			config: {
				tools: [{ googleSearch: {} }],
				thinkingConfig: { includeThoughts: false },
				responseMimeType: 'application/json',
				responseSchema: {
					type: Type.OBJECT,
					properties: {
						protein: { type: Type.NUMBER, nullable: true },
						fat: { type: Type.NUMBER, nullable: true },
						carbs: { type: Type.NUMBER, nullable: true },
						fibers: { type: Type.NUMBER, nullable: true },
						sugar: { type: Type.NUMBER, nullable: true },
						mufa: { type: Type.NUMBER, nullable: true },
						pufa: { type: Type.NUMBER, nullable: true },
						sfa: { type: Type.NUMBER, nullable: true },
						gl: { type: Type.NUMBER, nullable: true },
						omega3: { type: Type.NUMBER, nullable: true },
						omega6: { type: Type.NUMBER, nullable: true },
						comment: { type: Type.STRING, nullable: true }
					},
					required: [
						'protein',
						'fat',
						'carbs',
						'fibers',
						'sugar',
						'mufa',
						'pufa',
						'sfa',
						'gl',
						'omega3',
						'omega6'
					]
				}
			}
		});

		const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
		if (!responseText) throw new Error('AI response for nutrition did not contain text.');

		let nutritionData: Partial<FoodItem>;
		try {
			nutritionData = JSON.parse(responseText);
		} catch {
			throw new Error('AI nutrition response JSON invalid.');
		}

		assert(
			typeof nutritionData.omega6 === 'number' || nutritionData.omega6 === null,
			`Omega 6 from AI must be number or null, got: ${typeof nutritionData.omega6}`
		);
		assert(
			typeof nutritionData.omega3 === 'number' || nutritionData.omega3 === null,
			`Omega 3 from AI must be number or null, got: ${typeof nutritionData.omega3}`
		);

		const itemToInsert = {
			name,
			serving_qty: standardQty,
			serving_unit: standardUnit,
			protein: nutritionData.protein ?? null,
			fat: nutritionData.fat ?? null,
			carbs: nutritionData.carbs ?? null,
			fibers: nutritionData.fibers ?? null,
			sugar: nutritionData.sugar ?? null,
			mufa: nutritionData.mufa ?? null,
			pufa: nutritionData.pufa ?? null,
			sfa: nutritionData.sfa ?? null,
			gl: nutritionData.gl ?? null,
			omega3: nutritionData.omega3 ?? null,
			omega6: nutritionData.omega6 ?? null,
			comment: nutritionData.comment?.trim() || null
		};

		const { data: insertedData, error: insertError } = await supabase
			.from('food_items')
			.insert([itemToInsert])
			.select('id')
			.single();

		if (insertError) throw insertError;
		if (!insertedData) throw new Error('Failed to insert new food item, no ID returned.');

		// Remember this insert so it can be cleaned up if the recipe is abandoned.
		sessionInsertedItemIds.add(insertedData.id);

		const { protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6 } =
			itemToInsert;
		return {
			id: insertedData.id,
			multiplier,
			serving_qty: standardQty,
			serving_unit: standardUnit,
			nutrition: { protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6 }
		};
	}

	type ExistingItemInfo = {
		id: number;
		name: string;
		serving_qty: number | null;
		serving_unit: string | null;
		// Add fields needed for Fuse search keys if expanding later
		// protein?: number | null; fat?: number | null; carbs?: number | null; fibers?: number | null; sugar?: number | null; mufa?: number | null; pufa?: number | null; sfa?: number | null; gl?: number | null; omega3?: number | null; omega6?: number | null; comment?: string | null;
	};

	type ContextImageSource = 'camera' | 'library';
	type RecipeContextImage = {
		id: string;
		blob: Blob;
		previewUrl: string;
		name: string;
		mimeType: string;
		source: ContextImageSource;
	};

	type GeminiPromptPart = { text: string } | { inlineData: { mimeType: string; data: string } };

	const MAX_CONTEXT_IMAGES = 3;
	const CONTEXT_IMAGE_MAX_EDGE = 1280;
	const CONTEXT_IMAGE_QUALITY = 0.75;

	let recipeName = '';
	let userComment = '';
	let allFoodItems: ExistingItemInfo[] = []; // Store all items fetched on mount
	let fuse: Fuse<ExistingItemInfo>; // Fuse instance for searching all items
	let contextImages: RecipeContextImage[] = [];
	let cameraInput: HTMLInputElement;
	let imageInput: HTMLInputElement;
	let isPreparingImages = false;

	// Update ingredient structure to include status and potentially editable fields
	type GeneratedIngredient = {
		name?: string; // For new items (before processing OR manually added new)
		quantity?: number; // For new items (before processing OR manually added new) - Original/Editable quantity
		unit?: 'g' | 'dl' | 'pcs' | 'portion'; // For new items (before processing OR manually added new) - Original/Editable unit (Allow all units)
		id?: number; // For matched items OR new items after insertion
		multiplier?: number; // For matched items OR new items after processing OR manually added existing
		matchedName?: string; // Display name for matched items
		serving_qty?: number | null; // Standard/Original serving qty (used for display and multiplier calculation)
		serving_unit?: string | null; // Standard/Original serving unit (used for display)
		status: 'idle' | 'processing' | 'done' | 'error';
		errorMsg?: string;
		isManuallyAdded?: boolean; // Flag to differentiate origin of new items
		// Store fetched/calculated nutrition for final sum
		nutrition?: NutritionData | null;
	};
	let generatedIngredients: GeneratedIngredient[] = [];
	// Track food_items inserted while building this recipe so they can be cleaned
	// up if the user cancels, removes an ingredient, or starts a new generation.
	// They are kept only once the recipe is actually created.
	let sessionInsertedItemIds = new Set<number>();
	let isLoadingList = false;
	let isLoadingRecipe = false; // Used for LLM list gen, processing, and saving
	let isFetchingExisting = false; // Separate flag for fetching existing item details
	// --- Manual Add State ---
	let manualAddSearchTerm = '';
	let manualAddSearchResults: FuseResult<ExistingItemInfo>[] = []; // Use imported FuseResult type
	let showManualAddResults = false;

	// --- Recipe Totals State ---
	// Define the keys we expect to sum and round (calories removed)
	const nutrientKeys = [
		'protein',
		'fat',
		'carbs',
		'fibers',
		'sugar',
		'mufa',
		'pufa',
		'sfa',
		'gl',
		'omega3',
		'omega6'
	] as const satisfies readonly (keyof NutritionData)[];
	type RecipeTotals = { [K in (typeof nutrientKeys)[number]]?: number } & {
		count: number;
		ratio?: string;
	};
	// Initialize totals with all expected keys set to 0, plus count and ratio
	let recipeTotals: RecipeTotals = { count: 0 };
	nutrientKeys.forEach((key) => (recipeTotals[key] = 0));

	let errorMessage = '';
	let successMessage = '';

	// --- Reactive State ---
	$: hasUnprocessedNewItems = generatedIngredients.some((ing) => !ing.id && ing.status === 'idle');
	$: canCreateRecipe =
		generatedIngredients.length > 0 && !generatedIngredients.some((ing) => ing.status !== 'done');

	// --- Gemini API State ---
	let geminiApiKey = '';
	let showApiKeyInput = false; // Control visibility of API key input
	let apiKeyInput = ''; // Temporary input for the API key field
	let geminiKeySource: GeminiKeySource = 'none';
	let geminiKeyStorageWarning: string | null = null;

	function createContextImageId() {
		if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function isImageFile(file: File) {
		return file.type.startsWith('image/') || /\.(avif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
	}

	function loadImageElement(file: File) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const previewUrl = URL.createObjectURL(file);
			const image = new Image();
			image.onload = () => {
				URL.revokeObjectURL(previewUrl);
				resolve(image);
			};
			image.onerror = () => {
				URL.revokeObjectURL(previewUrl);
				reject(new Error(`Could not read ${file.name || 'image'}.`));
			};
			image.src = previewUrl;
		});
	}

	async function compressContextImage(file: File) {
		const image = await loadImageElement(file);
		const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
		const scale = longEdge > CONTEXT_IMAGE_MAX_EDGE ? CONTEXT_IMAGE_MAX_EDGE / longEdge : 1;
		const width = Math.max(1, Math.round(image.naturalWidth * scale));
		const height = Math.max(1, Math.round(image.naturalHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not prepare image for Gemini.');
		context.fillStyle = '#fff';
		context.fillRect(0, 0, width, height);
		context.drawImage(image, 0, 0, width, height);

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(preparedBlob) =>
					preparedBlob ? resolve(preparedBlob) : reject(new Error('Could not compress image.')),
				'image/jpeg',
				CONTEXT_IMAGE_QUALITY
			);
		});

		return { blob, mimeType: 'image/jpeg' };
	}

	async function handleContextImageSelection(event: Event, source: ContextImageSource) {
		const input = event.currentTarget as HTMLInputElement;
		const selectedFiles = Array.from(input.files ?? []);
		input.value = '';
		if (selectedFiles.length === 0) return;

		const availableSlots = MAX_CONTEXT_IMAGES - contextImages.length;
		if (availableSlots <= 0) {
			errorMessage = `Use up to ${MAX_CONTEXT_IMAGES} images as recipe context.`;
			return;
		}

		const imageFiles = selectedFiles.filter(isImageFile);
		if (imageFiles.length === 0) {
			errorMessage = 'Choose an image file to use as recipe context.';
			return;
		}

		isPreparingImages = true;
		errorMessage = '';
		successMessage = '';

		try {
			const filesToAdd = imageFiles.slice(0, availableSlots);
			const preparedImages = await Promise.all(
				filesToAdd.map(async (file) => {
					const compressed = await compressContextImage(file);
					const previewUrl = URL.createObjectURL(compressed.blob);
					return {
						id: createContextImageId(),
						blob: compressed.blob,
						previewUrl,
						name: file.name || (source === 'camera' ? 'Camera photo' : 'Recipe image'),
						mimeType: compressed.mimeType,
						source
					};
				})
			);

			contextImages = [...contextImages, ...preparedImages];
			if (imageFiles.length > filesToAdd.length) {
				errorMessage = `Added ${filesToAdd.length} image${filesToAdd.length === 1 ? '' : 's'}. Use up to ${MAX_CONTEXT_IMAGES} at a time.`;
			}
		} catch (err: unknown) {
			errorMessage = `Could not prepare image context: ${getErrorMessage(err)}`;
			console.error(err);
		} finally {
			isPreparingImages = false;
		}
	}

	function removeContextImage(id: string) {
		const imageToRemove = contextImages.find((image) => image.id === id);
		if (imageToRemove) URL.revokeObjectURL(imageToRemove.previewUrl);
		contextImages = contextImages.filter((image) => image.id !== id);
	}

	function clearContextImages() {
		for (const image of contextImages) {
			URL.revokeObjectURL(image.previewUrl);
		}
		contextImages = [];
	}

	function blobToBase64(blob: Blob) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = String(reader.result ?? '');
				const [, base64Data = ''] = result.split(',');
				if (base64Data) {
					resolve(base64Data);
				} else {
					reject(new Error('Could not encode image for Gemini.'));
				}
			};
			reader.onerror = () => reject(new Error('Could not encode image for Gemini.'));
			reader.readAsDataURL(blob);
		});
	}

	async function buildContextImageParts(): Promise<GeminiPromptPart[]> {
		return Promise.all(
			contextImages.map(async (image) => ({
				inlineData: {
					mimeType: image.mimeType,
					data: await blobToBase64(image.blob)
				}
			}))
		);
	}

	// --- Calculate Recipe Totals Function ---
	function calculateRecipeTotals() {
		// Initialize newTotals with all expected keys set to 0 for calculation
		const newTotals: RecipeTotals = { count: 0 };
		nutrientKeys.forEach((key) => (newTotals[key] = 0));
		let calculatedCount = 0;

		for (const ingredient of generatedIngredients) {
			// Only include items that have been successfully processed
			if (ingredient.status === 'done' && ingredient.nutrition) {
				calculatedCount++;
				const nutrition = ingredient.nutrition;
				const multiplier = ingredient.multiplier ?? 1;

				// Helper to safely add numbers (treat null as 0)
				const add = (a: number | null | undefined, b: number | null | undefined) =>
					(a || 0) + (b || 0);

				// Sum nutrients
				newTotals.protein = add(newTotals.protein, (nutrition.protein || 0) * multiplier);
				newTotals.fat = add(newTotals.fat, (nutrition.fat || 0) * multiplier);
				newTotals.carbs = add(newTotals.carbs, (nutrition.carbs || 0) * multiplier);
				newTotals.fibers = add(newTotals.fibers, (nutrition.fibers || 0) * multiplier);
				newTotals.sugar = add(newTotals.sugar, (nutrition.sugar || 0) * multiplier);
				newTotals.mufa = add(newTotals.mufa, (nutrition.mufa || 0) * multiplier);
				newTotals.pufa = add(newTotals.pufa, (nutrition.pufa || 0) * multiplier);
				newTotals.sfa = add(newTotals.sfa, (nutrition.sfa || 0) * multiplier);
				newTotals.gl = add(newTotals.gl, (nutrition.gl || 0) * multiplier);
				newTotals.omega3 = add(newTotals.omega3, (nutrition.omega3 || 0) * multiplier);
				newTotals.omega6 = add(newTotals.omega6, (nutrition.omega6 || 0) * multiplier);
			}
		}
		newTotals.count = calculatedCount;

		// Round the calculated totals for defined keys
		for (const key of nutrientKeys) {
			newTotals[key] = Math.round(newTotals[key]!);
		}

		// Calculate ratio
		// Calculate ratio using the new utility function
		const calculatedRatio = ratio(newTotals.omega6, newTotals.omega3); // Use the imported ratio function

		// Assign the calculated ratio (string | undefined)
		newTotals.ratio = calculatedRatio;

		recipeTotals = newTotals; // Assign the final totals to the state variable
	}

	// --- Lifecycle ---
	onMount(async () => {
		loadApiKey(); // Load API key on mount
		await fetchAllFoodItems(); // Fetch all items for manual search
	});

	onDestroy(() => {
		for (const image of contextImages) {
			URL.revokeObjectURL(image.previewUrl);
		}
	});

	// --- Fetch All Food Items for Manual Search ---
	async function fetchAllFoodItems() {
		isFetchingExisting = true;
		errorMessage = ''; // Clear previous errors
		try {
			const { data, error } = await supabase
				.from('food_items')
				.select('id, name, serving_qty, serving_unit'); // Only fetch needed fields initially

			if (error) throw error;
			allFoodItems = data || [];

			// Initialize Fuse.js for searching
			fuse = new Fuse(allFoodItems, {
				keys: ['name'], // Search only by name for simplicity now
				includeScore: true,
				threshold: 0.4 // Adjust threshold as needed
			});
		} catch (err: unknown) {
			errorMessage = `Error fetching food items: ${getErrorMessage(err)}`;
			console.error(err);
		} finally {
			isFetchingExisting = false;
		}
	}

	// --- API Key Handling ---
	function applyGeminiKeyResult(result: GeminiKeyResult) {
		geminiApiKey = result.key;
		apiKeyInput = result.key;
		geminiKeySource = result.source;
		geminiKeyStorageWarning = result.errorMessage ?? null;
	}

	async function loadApiKey() {
		applyGeminiKeyResult(await loadGeminiKeyForUser());
	}

	function showApiKeyEditor() {
		apiKeyInput = geminiApiKey;
		showApiKeyInput = true;
		errorMessage = '';
	}

	async function saveApiKey() {
		const savedKey = apiKeyInput.trim();
		if (!savedKey) {
			await clearApiKey();
			return;
		}

		try {
			applyGeminiKeyResult(await saveGeminiKeyForUser(savedKey));
			showApiKeyInput = false;
			errorMessage = '';
			alert(
				geminiKeySource === 'profile'
					? 'API Key saved to profile.'
					: 'API Key saved in this browser.'
			);
		} catch (err: unknown) {
			errorMessage = getErrorMessage(err);
			showApiKeyInput = true;
		}
	}

	async function clearApiKey() {
		try {
			applyGeminiKeyResult(await clearGeminiKeyForUser());
			showApiKeyInput = true;
			errorMessage = '';
		} catch (err: unknown) {
			errorMessage = getErrorMessage(err);
			showApiKeyInput = true;
		}
	}

	function getGeminiKeyStatusText() {
		if (geminiKeySource === 'profile') return 'Gemini key saved in profile';
		if (geminiKeySource === 'browser') return 'Gemini key saved on this device';
		return 'Uses Gemini AI. Save a key to generate recipes.';
	}

	async function generateIngredientList() {
		isLoadingList = true;
		errorMessage = '';
		successMessage = '';
		// Starting a fresh list abandons any items inserted in the previous attempt.
		await discardSessionInsertedItems();
		generatedIngredients = [];
		calculateRecipeTotals(); // Reset totals display
		let sentContextImages = false;
		let includedContextImages = false;

		try {
			// 1. Check for API Key (Moved check earlier)
			if (!geminiApiKey) {
				errorMessage = 'Gemini API Key is missing. Please enter and save it below.';
				showApiKeyInput = true;
				isLoadingList = false;
				return;
			}

			// 2. Construct Prompt 1 (Use allFoodItems fetched onMount)
			const existingItemsString = allFoodItems
				.map(
					(item) =>
						`ID: ${item.id}, Name: ${item.name}, Serving: ${item.serving_qty || 'N/A'} ${item.serving_unit || ''}`
				)
				.join('\n');

			includedContextImages = contextImages.length > 0;
			const imageContextInstructions = includedContextImages
				? `
Use the attached images as temporary visual context for this recipe:
- If an image shows a finished dish or visible ingredients, identify the main calorie and macronutrient contributors and estimate rough proportions.
- If an image shows a menu, recipe card, package, handwritten note, or printed text, read the visible text and use it as recipe context.
- If an image shows nutrition facts or ingredient labels, use them to refine ingredient names and quantities.
- If the images conflict with the typed recipe name or comment, the typed text wins.
- Ignore tableware, background objects, logos, decoration, and tiny seasonings unless they materially affect calories or macronutrients.
Do not describe the images in the response. Return only the requested JSON.`
				: '';

			const prompt = `Given the recipe name "${recipeName}" ${userComment ? `and comment "${userComment}"` : ''}, identify the main ingredients and their quantities (in grams 'g' or deciliters 'dl').
Focus *only* on ingredients that significantly contribute to the recipe's total calories and macronutrient profile (protein, fat, carbohydrates). Exclude small amounts of herbs, spices, flavorings (like garlic, salt, pepper, small amounts of chili), water, and other non-caloric or very low-calorie items.
Compare these ingredients against the following list of existing food items:
--- EXISTING ITEMS ---
${existingItemsString}
--- END EXISTING ITEMS ---

If an ingredient closely matches an existing item by name, return an object with its id and a multiplier relative to its defined serving size.
If an ingredient does not match, return an object with its name (use simple, common names like "Flour"), quantity, and unit ('g' or 'dl'). Prioritize 'g' for solids and 'dl' for liquids where appropriate.${imageContextInstructions}`;

			// 3. Call Gemini API
			const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
			const promptParts = [...(await buildContextImageParts()), { text: prompt }];
			sentContextImages = includedContextImages;
			const result = await genAI.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: promptParts }],
				config: {
					responseMimeType: 'application/json',
					responseSchema: {
						type: Type.ARRAY,
						items: {
							type: Type.OBJECT,
							properties: {
								name: { type: Type.STRING, nullable: true },
								quantity: { type: Type.NUMBER, nullable: true },
								unit: { type: Type.STRING, nullable: true },
								id: { type: Type.INTEGER, nullable: true },
								multiplier: { type: Type.NUMBER, nullable: true }
							}
						}
					}
				}
			});

			const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
			if (!responseText) {
				throw new Error('AI response did not contain text.');
			}

			// 4. Parse JSON Response
			let parsedIngredients: ParsedIngredient[];
			try {
				parsedIngredients = JSON.parse(responseText) as ParsedIngredient[];
			} catch (parseError) {
				console.error(
					'Failed to parse Gemini JSON response:',
					parseError,
					'\nResponse:',
					responseText
				);
				throw new Error('AI returned invalid JSON for ingredient list.');
			}

			// 5. Map LLM response to internal structure (using allFoodItems for lookup)
			const finalIngredients: GeneratedIngredient[] = [];
			for (const ingredient of parsedIngredients) {
				if (ingredient.id) {
					const matchedItem = allFoodItems.find((item) => item.id === ingredient.id); // Use allFoodItems
					finalIngredients.push({
						id: ingredient.id,
						multiplier: ingredient.multiplier, // Keep LLM multiplier for now, will be editable
						matchedName: matchedItem ? matchedItem.name : `Unknown Item (ID: ${ingredient.id})`,
						serving_qty: matchedItem ? matchedItem.serving_qty : null,
						serving_unit: matchedItem ? matchedItem.serving_unit : null,
						status: 'idle', // Will fetch nutrition later if needed or when processed
						nutrition: null
					});
				} else {
					// Ensure new items have the correct structure and calculate multiplier
					const llmQuantity = ingredient.quantity ?? 0;
					const llmUnit = normalizeIngredientUnit(ingredient.unit);
					// Determine standard size for nutrition fetching later
					const standardUnit = llmUnit;
					const standardQty = standardUnit === 'g' ? 100 : 1;
					// Calculate multiplier based on LLM quantity vs standard quantity
					const calculatedMultiplier = llmQuantity / standardQty;

					finalIngredients.push({
						name: ingredient.name,
						quantity: llmQuantity, // Store original LLM quantity for display/retry
						unit: llmUnit, // Store original LLM unit for display/retry
						multiplier: calculatedMultiplier, // Store calculated multiplier
						status: 'idle',
						isManuallyAdded: false, // Mark as not manually added
						nutrition: null
						// Store the standard serving size used for multiplier calc, might be useful later?
						// serving_qty: standardQty,
						// serving_unit: standardUnit
					});
				}
			}

			generatedIngredients = finalIngredients;
			calculateRecipeTotals(); // Calculate totals after initial list generation
			if (includedContextImages) {
				successMessage = 'Ingredient list generated. Image context cleared.';
			}
		} catch (err: unknown) {
			const message = getErrorMessage(err);
			// Handle potential API key errors specifically
			if (message.includes('API key not valid')) {
				errorMessage = 'Gemini API Key is invalid. Please check and save it again.';
				showApiKeyInput = true;
			} else {
				errorMessage = `Error generating list: ${message}`;
			}
			console.error(err);
		} finally {
			if (sentContextImages) {
				clearContextImages();
			}
			isLoadingList = false;
		}
	}

	// Delete any food_items inserted during this recipe-building session and reset
	// the tracking set. Best-effort: logs on failure rather than blocking the UI.
	async function discardSessionInsertedItems() {
		if (sessionInsertedItemIds.size === 0) return;
		const ids = Array.from(sessionInsertedItemIds);
		sessionInsertedItemIds = new Set();
		try {
			const { error } = await supabase.from('food_items').delete().in('id', ids);
			if (error) throw error;
		} catch (err: unknown) {
			console.error('Failed to clean up session-inserted ingredient items:', err);
		}
	}

	// Cancel the whole flow: discard inserted items so the Foods list stays clean.
	async function cancelRecipe() {
		await discardSessionInsertedItems();
		generatedIngredients = [];
		errorMessage = '';
		successMessage = '';
		clearContextImages();
		calculateRecipeTotals();
	}

	async function deleteIngredient(index: number) {
		const removed = generatedIngredients[index];
		generatedIngredients.splice(index, 1);
		generatedIngredients = generatedIngredients; // Trigger reactivity
		calculateRecipeTotals(); // Recalculate totals after deletion

		// If this ingredient was inserted earlier in this session, remove the
		// now-orphaned food_items row too so the Foods list stays clean.
		if (removed?.id && sessionInsertedItemIds.has(removed.id)) {
			sessionInsertedItemIds.delete(removed.id);
			try {
				const { error } = await supabase.from('food_items').delete().eq('id', removed.id);
				if (error) throw error;
			} catch (err: unknown) {
				console.error('Failed to remove session-inserted ingredient item:', err);
			}
		}
	}

	// --- Manual Add Functions ---
	function handleSearchInput() {
		if (manualAddSearchTerm.trim() === '') {
			manualAddSearchResults = [];
			showManualAddResults = false;
			return;
		}
		// Ensure fuse is initialized before searching
		if (fuse) {
			manualAddSearchResults = fuse.search(manualAddSearchTerm.trim());
		} else {
			manualAddSearchResults = []; // Handle case where fuse might not be ready
		}
		showManualAddResults = true;
	}

	async function addExistingIngredient(itemInfo: ExistingItemInfo) {
		manualAddSearchTerm = ''; // Clear search
		manualAddSearchResults = [];
		showManualAddResults = false;
		isFetchingExisting = true; // Show loading indicator while fetching details
		errorMessage = '';

		try {
			// Fetch full nutrition details for the selected item
			const { data: fullItem, error: fetchError } = await supabase
				.from('food_items')
				.select('*') // Select all columns for nutrition
				.eq('id', itemInfo.id)
				.single();

			if (fetchError) throw fetchError;
			if (!fullItem) throw new Error(`Details not found for item ID ${itemInfo.id}`);

			// Add to the list with status 'done' and multiplier 1
			generatedIngredients = [
				...generatedIngredients,
				{
					id: fullItem.id,
					multiplier: 1, // Default multiplier
					matchedName: fullItem.name,
					serving_qty: fullItem.serving_qty,
					serving_unit: fullItem.serving_unit,
					status: 'done',
					nutrition: {
						// Extract nutrition fields
						protein: fullItem.protein,
						fat: fullItem.fat,
						carbs: fullItem.carbs,
						fibers: fullItem.fibers,
						sugar: fullItem.sugar,
						mufa: fullItem.mufa,
						pufa: fullItem.pufa,
						sfa: fullItem.sfa,
						gl: fullItem.gl,
						omega3: fullItem.omega3,
						omega6: fullItem.omega6
					}
				}
			];
			calculateRecipeTotals(); // Update totals
		} catch (err: unknown) {
			errorMessage = `Error adding existing item: ${getErrorMessage(err)}`;
			console.error(err);
		} finally {
			isFetchingExisting = false;
		}
	}

	function addNewIngredient(name: string) {
		manualAddSearchTerm = ''; // Clear search
		manualAddSearchResults = [];
		showManualAddResults = false;

		// Add new item with default 100g and status 'idle'
		generatedIngredients = [
			...generatedIngredients,
			{
				name: name.trim(),
				quantity: 100, // Default quantity
				unit: 'g', // Default unit
				status: 'idle',
				isManuallyAdded: true, // Mark as manually added
				nutrition: null
			}
		];
		// No need to calculate totals here, as it adds 0 until processed
		// calculateRecipeTotals();
	}

	// --- Handle Edits in List ---
	function handleIngredientEdit() {
		// Simply recalculate totals. The bind:value handles state update.
		// Use tick to ensure calculation happens after Svelte updates the DOM/state
		tick().then(calculateRecipeTotals);
	}

	// --- Step B Function: Process New Ingredients ---
	async function processNewIngredients() {
		// Only process items that are new AND idle
		const newIngredientJobs = generatedIngredients
			.map((ingredient, originalIndex) => ({ ingredient, originalIndex }))
			.filter(({ ingredient }) => !ingredient.id && ingredient.status === 'idle');

		// If no new items to process, check if we need to fetch existing item nutrition
		if (newIngredientJobs.length === 0) {
			await fetchNutritionForExistingIdleItems(); // Call the separated fetch logic
			// Check if *all* items are done after potentially fetching existing ones
			if (generatedIngredients.every((ing) => ing.status === 'done')) {
				successMessage = 'All ingredients ready.'; // Update success message
			}
			return; // Exit processing early
		}

		isLoadingRecipe = true; // Indicate processing is happening
		errorMessage = '';
		successMessage = '';

		// Ensure API key exists before proceeding
		if (!geminiApiKey) {
			errorMessage = 'Gemini API Key is missing. Please enter and save it below.';
			showApiKeyInput = true;
			isLoadingRecipe = false;
			return;
		}

		const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

		try {
			// Step B: Process New Ingredients in Parallel (using the filtered newIngredientJobs)

			const processingPromises = newIngredientJobs.map(async ({ ingredient, originalIndex }) => {
				// Update status immediately for UI feedback using the original index
				// Ensure we are updating the correct object in the main array
				const targetIngredient = generatedIngredients[originalIndex];
				if (targetIngredient) {
					targetIngredient.status = 'processing';
				}
				// generatedIngredients[originalIndex].status = 'processing'; // This might modify a stale object if array ref changed
				generatedIngredients = [...generatedIngredients]; // Trigger reactivity early

				// Use the potentially edited quantity and unit from the ingredient object
				const { name, quantity, unit } = ingredient;
				if (!name || quantity === undefined || quantity === null || !unit) {
					// Throw rejection data, including the originalIndex
					throw {
						originalIndex,
						reason: `Missing data (name, quantity, or unit) for ingredient at original index ${originalIndex}`
					};
				}

				try {
					const processed = await processSingleIngredient(genAI, name, quantity, unit);
					return { status: 'fulfilled', originalIndex, ...processed };
				} catch (itemError: unknown) {
					console.error(`Error processing "${name}" (index ${originalIndex}):`, itemError);
					throw {
						originalIndex,
						reason: getErrorMessage(itemError)
					};
				}
			});

			// 2. Execute all processing promises concurrently
			const results = await Promise.allSettled(processingPromises);

			// 3. Create a new array based on results using the originalIndex
			const updatedIngredients = generatedIngredients.map((originalIngredient, index) => {
				const result = results.find((r) => {
					// Find the result corresponding to this original index
					if (r.status === 'fulfilled') {
						return (r.value as { originalIndex: number }).originalIndex === index;
					} else {
						// status === 'rejected'
						return (r.reason as { originalIndex: number }).originalIndex === index;
					}
				});

				if (!result) {
					// Should not happen if logic is correct, but return original as fallback
					console.warn(
						`No result found for original index ${index}, returning original ingredient state.`
					);
					return originalIngredient;
				}

				if (result.status === 'fulfilled') {
					// Type assertion for success payload (adjust if you have a specific type)
					const value = result.value as {
						originalIndex: number;
						id: number;
						multiplier: number;
						serving_qty: number;
						serving_unit: string;
						nutrition: NutritionData;
					};
					// Return a *new* object with all updated properties
					return {
						...originalIngredient, // Keep any existing properties not overwritten
						id: value.id,
						multiplier: value.multiplier,
						serving_qty: value.serving_qty,
						serving_unit: value.serving_unit,
						status: 'done' as const,
						nutrition: value.nutrition,
						errorMsg: undefined // Clear any previous error
					};
				} else {
					// status === 'rejected'
					// Type assertion for the thrown error object
					const rejectionPayload = result.reason as { originalIndex: number; reason: string };
					// Return a *new* object with error status
					return {
						...originalIngredient, // Keep existing properties
						status: 'error' as const,
						errorMsg: rejectionPayload.reason // Extract the reason string
					};
				}
			});

			// Assign the newly created array to trigger Svelte reactivity correctly
			generatedIngredients = updatedIngredients;
			calculateRecipeTotals(); // Calculate totals after processing new items

			// 4. Check if any items failed *after* the state update
			const failedItems = generatedIngredients.filter((ing) => ing.status === 'error');
			if (failedItems.length > 0) {
				const errorMessages = failedItems
					.map(
						(ing) =>
							`${ing.name || `Item at index ${generatedIngredients.indexOf(ing)}`}: ${ing.errorMsg}`
					)
					.join('; ');
				throw new Error(
					`Failed to process ${failedItems.length} new ingredient(s): ${errorMessages}`
				);
			}

			// --- Step C: Fetch Existing Item Nutrition --- (Now a separate function call)
			await fetchNutritionForExistingIdleItems();

			// Check for errors again after fetching existing item nutrition
			const finalFailedItemsAfterFetch = generatedIngredients.filter(
				(ing) => ing.status === 'error'
			);
			if (finalFailedItemsAfterFetch.length > 0) {
				// Throw a combined error message if needed, or rely on the error set in fetchNutritionForExistingIdleItems
				throw new Error(
					`Failed to fetch nutrition for ${finalFailedItemsAfterFetch.length} existing ingredient(s). Check individual items for details.`
				);
			}

			// If we reach here, all items should be 'done' or were already 'done'
			if (generatedIngredients.every((ing) => ing.status === 'done')) {
				successMessage = 'All ingredients processed successfully. Ready to create recipe.';
			} else {
				// This case might happen if only existing items were present initially and fetch failed
				// Error message should already be set by fetchNutritionForExistingIdleItems
				console.warn("Processing finished, but not all items are 'done'. Check for errors.");
			}
		} catch (err: unknown) {
			const message = getErrorMessage(err);
			// Handle potential API key errors specifically
			if (message.includes('API key not valid')) {
				errorMessage = 'Gemini API Key is invalid. Please check and save it again.';
				showApiKeyInput = true;
			} else {
				errorMessage = `Error processing ingredients: ${message}`;
			}
			console.error(err);
		} finally {
			isLoadingRecipe = false; // Finish loading after processing this batch
		}
		// Note: Saving is still a separate button click.
	}

	// --- Helper Function to Fetch Nutrition for Existing Idle Items ---
	async function fetchNutritionForExistingIdleItems() {
		const nutrientFields =
			'protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6';
		const existingItemIdsToFetch = generatedIngredients
			.filter((ing) => ing.id && ing.status === 'idle') // Only fetch for matched items not yet processed
			.map((ing) => ing.id!); // Use non-null assertion as we filter for ing.id

		if (existingItemIdsToFetch.length === 0) {
			return; // Nothing to fetch
		}

		isFetchingExisting = true; // Indicate fetching
		errorMessage = ''; // Clear previous errors specific to this step

		try {
			const { data: existingNutrients, error: fetchError } = await supabase
				.from('food_items')
				.select(`id, ${nutrientFields}`)
				.in('id', existingItemIdsToFetch);

			if (fetchError)
				throw new Error(`Failed to fetch nutrition for existing items: ${fetchError.message}`);

			// Store fetched nutrition in the generatedIngredients array
			let needsReactivityUpdate = false;
			for (let i = 0; i < generatedIngredients.length; i++) {
				const ingredient = generatedIngredients[i];
				if (ingredient.id && ingredient.status === 'idle') {
					const fetched = existingNutrients?.find((n) => n.id === ingredient.id);
					if (fetched) {
						// Create a *new* object for the updated ingredient to ensure reactivity
						generatedIngredients[i] = {
							...ingredient,
							nutrition: {
								// Extract only nutrient fields
								protein: fetched.protein,
								fat: fetched.fat,
								carbs: fetched.carbs,
								fibers: fetched.fibers,
								sugar: fetched.sugar,
								mufa: fetched.mufa,
								pufa: fetched.pufa,
								sfa: fetched.sfa,
								gl: fetched.gl,
								omega3: fetched.omega3,
								omega6: fetched.omega6
							},
							status: 'done' // Mark as done
						};
						needsReactivityUpdate = true;
					} else {
						// Update status to error directly on the existing object reference
						ingredient.status = 'error';
						ingredient.errorMsg = `Nutrition data not found for existing item ID ${ingredient.id}`;
						needsReactivityUpdate = true; // Still need to trigger update
					}
				}
			}

			if (needsReactivityUpdate) {
				generatedIngredients = [...generatedIngredients]; // Trigger reactivity
				calculateRecipeTotals(); // Recalculate totals after fetching existing item data
			}
		} catch (err: unknown) {
			const message = getErrorMessage(err);
			// Handle errors during fetch, potentially marking items as failed
			errorMessage = message; // Display the fetch error
			// Mark the items we tried to fetch as errored
			let errorUpdateNeeded = false;
			for (let i = 0; i < generatedIngredients.length; i++) {
				const ingredient = generatedIngredients[i];
				// Check if this item was one we attempted to fetch
				if (
					ingredient.id &&
					existingItemIdsToFetch.includes(ingredient.id) &&
					ingredient.status === 'idle'
				) {
					ingredient.status = 'error';
					ingredient.errorMsg = `Failed to fetch nutrition: ${message}`;
					errorUpdateNeeded = true;
				}
			}
			if (errorUpdateNeeded) {
				generatedIngredients = [...generatedIngredients];
				calculateRecipeTotals(); // Recalculate totals if errors occurred
			}
			// Re-throw the error so the calling function knows something went wrong
			throw err;
		} finally {
			isFetchingExisting = false;
		}
	}

	// --- Step C Function: Save Final Recipe ---
	async function saveFinalRecipe() {
		// Use the reactive variable `canCreateRecipe` which already checks status
		if (!canCreateRecipe) {
			errorMessage =
				"Cannot create recipe: Ensure all ingredients are processed successfully (status 'done') and have no errors.";
			return;
		}

		isLoadingRecipe = true;
		errorMessage = '';
		successMessage = '';

		try {
			// Redundant check (already covered by canCreateRecipe), but safe to keep
			// const finalFailedItems = generatedIngredients.filter(ing => ing.status === 'error');
			// if (finalFailedItems.length > 0) {
			//    throw new Error(`Cannot create recipe: ${finalFailedItems.length} ingredient(s) still have errors.`);
			// }

			// Prepare and Insert Final Recipe Item
			const ingredientSummary = generatedIngredients
				.filter((ing) => ing.status === 'done')
				.map((ing) => {
					const displayName = ing.matchedName || ing.name || 'Unknown';
					const qty = ing.serving_qty || '?';
					const unit = ing.serving_unit || 'unit';
					const mult = ing.multiplier || 1;
					const formattedMultiplier = Number.isInteger(mult) ? mult : mult.toFixed(2);
					return `${formattedMultiplier}x ${displayName} (${qty} ${unit})`;
				})
				.join(', ');

			const finalComment = userComment
				? `${userComment}\n---\nIngredients: ${ingredientSummary}`
				: `Ingredients: ${ingredientSummary}`;

			// Use the already calculated recipeTotals for insertion
			const recipeToInsert = {
				name: recipeName.trim(),
				serving_qty: 1,
				serving_unit: 'portion',
				comment: finalComment,
				protein: recipeTotals.protein ?? null,
				fat: recipeTotals.fat ?? null,
				carbs: recipeTotals.carbs ?? null,
				fibers: recipeTotals.fibers ?? null,
				sugar: recipeTotals.sugar ?? null,
				mufa: recipeTotals.mufa ?? null,
				pufa: recipeTotals.pufa ?? null,
				sfa: recipeTotals.sfa ?? null,
				gl: recipeTotals.gl ?? null,
				omega3: recipeTotals.omega3 ?? null,
				omega6: recipeTotals.omega6 ?? null
			};

			const { error: recipeInsertError } = await supabase
				.from('food_items')
				.insert([recipeToInsert]);

			if (recipeInsertError) throw recipeInsertError;

			successMessage = `Recipe "${recipeName}" created successfully!`;
			// Recipe created — the inserted ingredient items are now legitimately part
			// of the user's Foods, so stop tracking them for cleanup.
			sessionInsertedItemIds = new Set();
			generatedIngredients = []; // Clear the list on success
			calculateRecipeTotals(); // Reset totals display
		} catch (err: unknown) {
			errorMessage = `Error saving recipe: ${getErrorMessage(err)}`;
			console.error(err);
		} finally {
			isLoadingRecipe = false;
		}
	}

	async function retryProcessIngredient(index: number) {
		const ingredient = generatedIngredients[index];
		if (!ingredient || ingredient.status !== 'error') return;

		ingredient.status = 'processing';
		ingredient.errorMsg = undefined;
		generatedIngredients = [...generatedIngredients];

		if (!geminiApiKey) {
			ingredient.status = 'error';
			ingredient.errorMsg = 'API Key missing for retry.';
			generatedIngredients = [...generatedIngredients];
			showApiKeyInput = true;
			return;
		}

		const { name, quantity, unit } = ingredient;
		if (!name || !quantity || !unit) {
			const errorName = ingredient.name || ingredient.matchedName || `Item at index ${index}`;
			ingredient.status = 'error';
			ingredient.errorMsg = `Cannot retry ${errorName}: Missing original name, quantity, or unit.`;
			generatedIngredients = [...generatedIngredients];
			return;
		}

		const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

		try {
			const processed = await processSingleIngredient(genAI, name, quantity, unit);
			ingredient.status = 'done';
			ingredient.id = processed.id;
			ingredient.multiplier = processed.multiplier;
			ingredient.serving_qty = processed.serving_qty;
			ingredient.serving_unit = processed.serving_unit;
			ingredient.nutrition = processed.nutrition;
			ingredient.errorMsg = undefined;
		} catch (retryError: unknown) {
			console.error(`Retry failed for "${name}" (index ${index}):`, retryError);
			const message = getErrorMessage(retryError);
			if (message.includes('API key not valid')) {
				errorMessage = 'Gemini API Key is invalid. Please check and save it again.';
				showApiKeyInput = true;
			}
			ingredient.status = 'error';
			ingredient.errorMsg = `Retry failed: ${message}`;
		} finally {
			generatedIngredients = [...generatedIngredients];
			calculateRecipeTotals();
		}
	}
</script>

<svelte:head>
	<title>Generate Recipe</title>
</svelte:head>

<div class="container mx-auto max-w-3xl p-4">
	<h1 class="mb-4 text-2xl font-bold">Generate Recipe from Name</h1>

	<div class="mb-4">
		<label for="recipeName" class="mb-1 block text-sm font-medium text-gray-700">Recipe Name</label>
		<input
			type="text"
			id="recipeName"
			bind:value={recipeName}
			class="w-full rounded border border-gray-300 p-2"
			placeholder="e.g., Chicken Stir-fry"
		/>
	</div>

	<div class="mb-4">
		<label for="userComment" class="mb-1 block text-sm font-medium text-gray-700"
			>Optional Comment</label
		>
		<textarea
			id="userComment"
			bind:value={userComment}
			rows="3"
			class="w-full rounded border border-gray-300 p-2"
			placeholder="Any specific notes, like 'low carb version' or 'serves 2'"
		></textarea>
	</div>

	<div class="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 shadow-sm">
		<input
			bind:this={cameraInput}
			type="file"
			accept="image/*"
			capture="environment"
			class="hidden"
			aria-label="Take recipe context photo"
			on:change={(event) => handleContextImageSelection(event, 'camera')}
		/>
		<input
			bind:this={imageInput}
			type="file"
			accept="image/*"
			multiple
			class="hidden"
			aria-label="Add recipe context image"
			on:change={(event) => handleContextImageSelection(event, 'library')}
		/>

		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-gray-800">Image context</h2>
				<p class="mt-0.5 text-xs text-gray-500">
					Sent once to Gemini for ingredient context, then cleared.
				</p>
			</div>
			<span class="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm">
				{contextImages.length}/{MAX_CONTEXT_IMAGES}
			</span>
		</div>

		<div class="mt-3 grid grid-cols-2 gap-2">
			<button
				type="button"
				on:click={() => cameraInput?.click()}
				disabled={contextImages.length >= MAX_CONTEXT_IMAGES ||
					isPreparingImages ||
					isLoadingList ||
					isLoadingRecipe}
				class="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Camera size={18} aria-hidden="true" />
				Take photo
			</button>
			<button
				type="button"
				on:click={() => imageInput?.click()}
				disabled={contextImages.length >= MAX_CONTEXT_IMAGES ||
					isPreparingImages ||
					isLoadingList ||
					isLoadingRecipe}
				class="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<ImagePlus size={18} aria-hidden="true" />
				Add image
			</button>
		</div>

		{#if isPreparingImages}
			<p class="mt-2 text-xs text-gray-500">Preparing image context...</p>
		{/if}

		{#if contextImages.length > 0}
			<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
				{#each contextImages as image (image.id)}
					<div class="relative overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-gray-200">
						<img
							src={image.previewUrl}
							alt={image.name}
							class="aspect-square w-full object-cover"
						/>
						<span
							class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
						>
							{image.source === 'camera' ? 'Photo' : 'Image'}
						</span>
						<button
							type="button"
							on:click={() => removeContextImage(image.id)}
							disabled={isLoadingList || isLoadingRecipe}
							class="absolute top-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-sm hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
							aria-label={`Remove ${image.name}`}
							title="Remove image"
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<button
		on:click={generateIngredientList}
		disabled={!recipeName || isLoadingList || isLoadingRecipe || isPreparingImages}
		class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#if isLoadingList}
			Generating List...
		{:else}
			Generate Ingredient List
		{/if}
	</button>
	<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
		{#if geminiApiKey}
			<span class="text-green-700">{getGeminiKeyStatusText()}</span>
			<button type="button" on:click={showApiKeyEditor} class="text-indigo-700 hover:underline">
				Change
			</button>
			<button type="button" on:click={clearApiKey} class="text-gray-600 hover:underline">
				Clear
			</button>
		{:else}
			<span class="text-gray-500">{getGeminiKeyStatusText()}</span>
			<button type="button" on:click={showApiKeyEditor} class="text-indigo-700 hover:underline">
				Add key
			</button>
		{/if}
	</div>
	{#if geminiKeyStorageWarning}
		<p class="mt-1 text-xs text-yellow-700">{geminiKeyStorageWarning}</p>
	{/if}

	<!-- API Key Input (conditionally shown) -->
	{#if showApiKeyInput}
		<div class="my-4 rounded border border-yellow-300 bg-yellow-50 p-3">
			<label for="gemini-api-key" class="block text-sm font-medium text-yellow-800"
				>Enter Gemini API Key:</label
			>
			<div class="mt-1 flex flex-col gap-2 sm:flex-row">
				<input
					type="password"
					id="gemini-api-key"
					bind:value={apiKeyInput}
					class="block w-full flex-1 rounded-md border-gray-300 px-2 py-1 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
					placeholder="Paste your API key here"
				/>
				<button
					type="button"
					on:click={saveApiKey}
					class="inline-flex items-center justify-center rounded-md border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
				>
					Save Key
				</button>
				{#if geminiApiKey}
					<button
						type="button"
						on:click={clearApiKey}
						class="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
					>
						Clear
					</button>
				{/if}
			</div>
			{#if errorMessage && (errorMessage.includes('API Key is missing') || errorMessage.includes('API Key is invalid'))}
				<p class="mt-1 text-xs text-red-600">{errorMessage}</p>
			{/if}
		</div>
	{/if}

	{#if errorMessage && !(errorMessage.includes('API Key is missing') || errorMessage.includes('API Key is invalid'))}
		<div class="mt-4 rounded border border-red-300 bg-red-100 p-3 text-red-700">
			{errorMessage}
		</div>
	{/if}
	{#if successMessage && !isLoadingRecipe}
		<div class="mt-4 rounded border border-green-300 bg-green-100 p-3 text-green-700">
			{successMessage}
		</div>
	{/if}

	{#if generatedIngredients.length > 0}
		<div class="mt-6">
			<h2 class="mb-3 text-xl font-semibold">Generated Ingredients</h2>
			<p class="mb-3 text-sm text-gray-600">
				Review the list below. Remove any unwanted items before approving.
			</p>
			<ul class="space-y-2">
				{#each generatedIngredients as ingredient, index (index)}
					{@const statusColor =
						ingredient.status === 'processing'
							? 'bg-yellow-50 border-yellow-200'
							: ingredient.status === 'done'
								? 'bg-green-50 border-green-200'
								: ingredient.status === 'error'
									? 'bg-red-50 border-red-200'
									: 'bg-white border-gray-200'}
					<li class={`rounded border p-2 ${statusColor}`}>
						<div class="flex items-center justify-between">
							<!-- Main ingredient info (potentially editable) -->
							<div class="mr-2 flex-grow">
								{#if ingredient.status === 'done'}
									<!-- DONE: Display name, serving size, and editable multiplier -->
									{@const displayName = ingredient.matchedName || ingredient.name || 'Unknown Item'}
									{@const displayQty = ingredient.serving_qty || '?'}
									{@const displayUnit = ingredient.serving_unit || 'unit'}
									<span class="mr-1">{displayName} ({displayQty} {displayUnit}) x</span>
									<input
										type="number"
										step="0.1"
										min="0.1"
										bind:value={ingredient.multiplier}
										on:input={handleIngredientEdit}
										class="w-16 rounded border border-gray-300 p-1 text-sm"
										disabled={isLoadingRecipe || isLoadingList}
									/>
								{:else if ingredient.status === 'processing'}
									<!-- PROCESSING: Display static info -->
									{#if !ingredient.id}
										{ingredient.quantity}{ingredient.unit}
										{ingredient.name} <span class="text-xs text-blue-500">(New)</span>
									{:else}
										{ingredient.matchedName} ({ingredient.serving_qty || '?'}
										{ingredient.serving_unit || 'unit'}) x {ingredient.multiplier}
									{/if}
									<span class="ml-2 text-xs text-yellow-600">Processing...</span>
								{:else if ingredient.status === 'error'}
									<!-- ERROR: Display static info + error + retry -->
									{#if !ingredient.id}
										{ingredient.quantity}{ingredient.unit}
										{ingredient.name} <span class="text-xs text-blue-500">(New)</span>
									{:else}
										{ingredient.matchedName} ({ingredient.serving_qty || '?'}
										{ingredient.serving_unit || 'unit'}) x {ingredient.multiplier}
									{/if}
									<span class="ml-1 text-xs text-red-600" title={ingredient.errorMsg}>Error!</span>
									<button
										type="button"
										on:click={() => retryProcessIngredient(index)}
										class="ml-1 rounded bg-indigo-100 px-1 py-0 text-xs text-indigo-700 hover:bg-indigo-200"
										title="Retry processing this ingredient"
										disabled={isLoadingRecipe}
									>
										🔄 Retry
									</button>
								{:else if ingredient.id}
									{@const displayName = ingredient.matchedName || `Item ID: ${ingredient.id}`}
									{@const displayQty = ingredient.serving_qty || '?'}
									{@const displayUnit = ingredient.serving_unit || 'unit'}
									<span class="mr-1">{displayName} ({displayQty} {displayUnit}) x</span>
									<input
										type="number"
										step="0.1"
										min="0.1"
										bind:value={ingredient.multiplier}
										on:input={handleIngredientEdit}
										class="w-16 rounded border border-gray-300 p-1 text-sm"
										disabled={isLoadingRecipe || isLoadingList}
										title="Edit multiplier"
									/>
									<span class="ml-2 text-xs text-gray-500">(Matched)</span>
								{:else if ingredient.isManuallyAdded}
									<input
										type="number"
										step="1"
										min="1"
										bind:value={ingredient.quantity}
										class="mr-1 w-16 rounded border border-gray-300 p-1 text-sm"
										disabled={isLoadingRecipe || isLoadingList}
										title="Edit quantity"
									/>
									<select
										bind:value={ingredient.unit}
										class="mr-1 rounded border border-gray-300 p-1 text-sm"
										disabled={isLoadingRecipe || isLoadingList}
										title="Edit unit"
									>
										<option value="g">g</option>
										<option value="dl">dl</option>
										<option value="pcs">pcs</option>
										<option value="portion">portion</option>
									</select>
									<span>{ingredient.name}</span>
									<span class="ml-1 text-xs text-blue-500">(New - Manual)</span>
								{:else}
									{@const displayName = ingredient.name || 'Unknown New Item'}
									{@const standardDisplayUnit = ingredient.unit === 'dl' ? 'dl' : 'g'}
									{@const standardDisplayQty = standardDisplayUnit === 'dl' ? 1 : 100}
									<span class="mr-1"
										>{displayName} ({standardDisplayQty} {standardDisplayUnit}) x</span
									>
									<input
										type="number"
										step="0.1"
										min="0.1"
										bind:value={ingredient.multiplier}
										on:input={handleIngredientEdit}
										class="w-16 rounded border border-gray-300 p-1 text-sm"
										disabled={isLoadingRecipe || isLoadingList}
										title="Edit multiplier"
									/>
									<span class="ml-1 text-xs text-blue-500">(New - LLM)</span>
								{/if}
							</div>

							<!-- Delete Button (remains the same) -->
							<button
								on:click={() => deleteIngredient(index)}
								disabled={isLoadingRecipe}
								class="ml-4 flex-shrink-0 text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
								aria-label="Delete ingredient"
								title="Delete Ingredient"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path
										fill-rule="evenodd"
										d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</div>
					</li>
				{/each}
			</ul>

			<!-- Manual Add Ingredient Section -->
			<div class="relative mt-4 border-t pt-4">
				<label for="manualAdd" class="mb-1 block text-sm font-medium text-gray-700"
					>Add Ingredient Manually</label
				>
				<input
					type="text"
					id="manualAdd"
					bind:value={manualAddSearchTerm}
					on:input={handleSearchInput}
					on:focus={() => (showManualAddResults = true)}
					on:blur={() => setTimeout(() => (showManualAddResults = false), 150)}
					class="w-full rounded border border-gray-300 p-2"
					placeholder="Search existing or type new name..."
					disabled={isFetchingExisting || isLoadingRecipe || isLoadingList}
				/>
				{#if isFetchingExisting}
					<p class="mt-1 text-xs text-gray-500 italic">Loading food items...</p>
				{/if}

				<!-- Search Results Dropdown -->
				{#if showManualAddResults && (manualAddSearchResults.length > 0 || manualAddSearchTerm.trim())}
					<ul
						class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-gray-300 bg-white shadow-lg"
					>
						{#each manualAddSearchResults as result (result.item.id)}
							<li>
								<button
									type="button"
									class="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
									on:mousedown|preventDefault={() => addExistingIngredient(result.item)}
								>
									{result.item.name}
									<span class="ml-1 text-xs text-gray-500">
										({result.item.serving_qty || '?'}
										{result.item.serving_unit || 'unit'})
									</span>
								</button>
							</li>
						{/each}
						{#if manualAddSearchTerm.trim() && !manualAddSearchResults.some((r) => r.item.name.toLowerCase() === manualAddSearchTerm
										.trim()
										.toLowerCase())}
							<li>
								<button
									type="button"
									class="w-full px-3 py-2 text-left text-sm text-indigo-600 italic hover:bg-indigo-50"
									on:mousedown|preventDefault={() => addNewIngredient(manualAddSearchTerm)}
								>
									Add "{manualAddSearchTerm.trim()}" as a new item (default 100g)
								</button>
							</li>
						{/if}
						{#if manualAddSearchResults.length === 0 && !manualAddSearchTerm.trim()}
							<li class="px-3 py-2 text-sm text-gray-500 italic">Start typing to search...</li>
						{/if}
					</ul>
				{/if}
			</div>

			<!-- Totals Display - Mimic styling from main page summary -->
			{#if recipeTotals.count > 0}
				<div class="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
					<h2 class="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
						Recipe Summary ({recipeTotals.count} ingredients)
					</h2>
					<NutrientBadges totals={recipeTotals} ratio={recipeTotals.ratio} />
				</div>
			{/if}

			<div class="mt-4 flex space-x-3">
				{#if hasUnprocessedNewItems}
					<!-- Button to process new items -->
					<button
						on:click={processNewIngredients}
						disabled={isLoadingList || isLoadingRecipe}
						class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoadingRecipe}
							Processing New Items...
						{:else}
							Fetch & Add New Ingredients
						{/if}
					</button>
				{:else if canCreateRecipe}
					<!-- Button to create the final recipe -->
					<button
						on:click={saveFinalRecipe}
						disabled={isLoadingList || isLoadingRecipe}
						class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoadingRecipe}
							Saving Recipe...
						{:else}
							Create Recipe
						{/if}
					</button>
				{/if}

				<button
					on:click={cancelRecipe}
					disabled={isLoadingList || isLoadingRecipe}
					class="rounded bg-gray-300 px-4 py-2 text-black hover:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>
