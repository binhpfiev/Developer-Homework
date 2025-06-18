import {
  GetRecipes,
  GetProductsForIngredient,
} from "./supporting-files/data-access";
import {
  ConvertUnits,
  GetNutrientFactInBaseUnits,
} from "./supporting-files/helpers";
import { ExpectedRecipeSummary, RunTest } from "./supporting-files/testing";
import {
  NutrientFact,
  UoMName,
  UoMType,
  UnitOfMeasure,
  SupplierProduct,
  Ingredient,
  Product,
  Recipe,
} from "./supporting-files/models";

console.clear();
console.log("Expected Result Is:", ExpectedRecipeSummary);

const recipeData = GetRecipes(); // the list of 1 recipe you should calculate the information for
console.log("Recipe Data:", recipeData);
const recipeSummary: any = {}; // the final result to pass into the test function
/*
 * YOUR CODE GOES BELOW THIS, DO NOT MODIFY ABOVE
 * (You can add more imports if needed)
 * */

/**
 * Converts between different units of measurement with fallback strategies.
 *
 * Conversion strategy:
 * 1. Try direct conversion first using the conversion table
 * 2. If direct conversion fails, attempt multi-step conversion:
 *    - For volume to mass: volume -> ml -> grams -> target mass unit
 *    - For mass to volume: mass -> grams -> ml -> target volume unit
 *
 * @param fromUoM - Source unit of measure
 * @param toUoMName - Target unit name
 * @param toUoMType - Target unit type
 * @throws Error if conversion path cannot be found
 * @returns Converted unit of measure
 */
function convertUnitsWithFallback(
  fromUoM: UnitOfMeasure,
  toUoMName: UoMName,
  toUoMType: UoMType
): UnitOfMeasure {
  try {
    // Attempt direct conversion first
    return ConvertUnits(fromUoM, toUoMName, toUoMType);
  } catch (error) {
    // For volume to mass conversions
    if (fromUoM.uomType === UoMType.volume && toUoMType === UoMType.mass) {
      return handleVolumeToMassConversion(fromUoM, toUoMName);
    }

    // For mass to volume conversions
    if (fromUoM.uomType === UoMType.mass && toUoMType === UoMType.volume) {
      return handleMassToVolumeConversion(fromUoM, toUoMName);
    }

    throw new Error(
      `Unsupported conversion: ${fromUoM.uomType} (${fromUoM.uomName}) -> ${toUoMType} (${toUoMName})`
    );
  }
}

/**
 * Handles volume to mass conversion through intermediate units
 * @param fromUoM - Source unit of measure
 * @param toUoMName - Target unit name
 * @returns Converted unit of measure in mass units
 */
function handleVolumeToMassConversion(
  fromUoM: UnitOfMeasure,
  toUoMName: UoMName
): UnitOfMeasure {
  // Convert to ml, then to grams, then to target unit
  const volumeInMl = ConvertUnits(fromUoM, UoMName.millilitres, UoMType.volume);

  const massInGrams = ConvertUnits(volumeInMl, UoMName.grams, UoMType.mass);

  return ConvertUnits(massInGrams, toUoMName, UoMType.mass);
}

/**
 * Handles mass to volume conversion through intermediate units
 * @param fromUoM - Source unit of measure
 * @param toUoMName - Target unit name
 * @returns Converted unit of measure in volume units
 */
function handleMassToVolumeConversion(
  fromUoM: UnitOfMeasure,
  toUoMName: UoMName
): UnitOfMeasure {
  // Convert to grams, then to ml, then to target unit
  const massInGrams = ConvertUnits(fromUoM, UoMName.grams, UoMType.mass);

  const volumeInMl = ConvertUnits(
    massInGrams,
    UoMName.millilitres,
    UoMType.volume
  );

  return ConvertUnits(volumeInMl, toUoMName, UoMType.volume);
}

/**
 * Calculates cost per gram for fair supplier comparison
 * @param supplier - Supplier product to calculate cost for
 * @returns Cost per gram of the product
 */
function getNormalizedCost(supplier: SupplierProduct): number {
  const supplierMassInGrams = convertUnitsWithFallback(
    supplier.supplierProductUoM,
    UoMName.grams,
    UoMType.mass
  ).uomAmount;

  return supplier.supplierPrice / supplierMassInGrams;
}

/**
 * Finds the cheapest supplier by comparing cost per gram
 * @param ingredient - Ingredient to find supplier for
 * @param availableProducts - List of available products for the ingredient
 * @returns Object containing the cheapest supplier and its cost
 * @throws Error if no supplier is found
 */
function findCheapestSupplier(
  ingredient: Ingredient,
  availableProducts: Product[]
) {
  let lowestNormalizedCost = Infinity;
  let selectedSupplier: {
    cost: number;
    product: Product;
    supplier: SupplierProduct;
  } | null = null;

  for (const product of availableProducts) {
    for (const supplier of product.supplierProducts) {
      const normalizedCost = getNormalizedCost(supplier);
      if (normalizedCost < lowestNormalizedCost) {
        lowestNormalizedCost = normalizedCost;
        selectedSupplier = { cost: normalizedCost, product, supplier };
      }
    }
  }

  if (!selectedSupplier) {
    throw new Error(
      `No supplier found for ingredient: ${ingredient.ingredientName}`
    );
  }

  return selectedSupplier;
}

/**
 * Calculates nutrient contribution for an ingredient
 * @param requiredUoM - Required unit of measure for the ingredient
 * @param selectedSupplier - Selected supplier for the ingredient
 * @param nutrientMap - Map to accumulate nutrient totals
 * @returns Total cost for this ingredient
 */
function calculateNutrientContribution(
  requiredUoM: UnitOfMeasure,
  selectedSupplier: {
    cost: number;
    product: Product;
    supplier: SupplierProduct;
  },
  nutrientMap: { [key: string]: NutrientFact }
): number {
  // Convert to grams: nutrition facts are standardized per 100g, and grams provide
  // consistent cost comparison across different units (ml, kg, whole items)
  const normalizedAmount = convertUnitsWithFallback(
    requiredUoM,
    UoMName.grams,
    UoMType.mass
  ).uomAmount;

  for (const nutrientFact of selectedSupplier.product.nutrientFacts) {
    const baseFact = GetNutrientFactInBaseUnits(nutrientFact);

    // Initialize nutrient entry if needed
    if (!nutrientMap[baseFact.nutrientName]) {
      nutrientMap[baseFact.nutrientName] = {
        nutrientName: baseFact.nutrientName,
        quantityAmount: {
          uomAmount: 0,
          uomName: baseFact.quantityAmount.uomName,
          uomType: baseFact.quantityAmount.uomType,
        },
        quantityPer: baseFact.quantityPer,
      };
    }

    // Calculate nutrient contribution for this ingredient
    const ingredientAmountInBaseUnit = convertUnitsWithFallback(
      requiredUoM,
      baseFact.quantityPer.uomName,
      baseFact.quantityPer.uomType
    ).uomAmount;

    const nutrientPerBaseUnit =
      baseFact.quantityAmount.uomAmount / baseFact.quantityPer.uomAmount;
    const totalNutrientAmount =
      nutrientPerBaseUnit * ingredientAmountInBaseUnit;

    // Calculate normalized contribution per 100g of recipe
    const normalizedValue =
      (totalNutrientAmount / normalizedAmount) * baseFact.quantityPer.uomAmount;

    // Add to total
    nutrientMap[baseFact.nutrientName].quantityAmount.uomAmount +=
      normalizedValue;
  }

  return normalizedAmount * selectedSupplier.cost;
}

/**
 * Sorts nutrient facts alphabetically by nutrient name
 * @param nutrientMap - Map of nutrient facts to sort
 * @returns New map with nutrients sorted alphabetically
 */
function sortNutrientsAlphabetically(nutrientMap: {
  [key: string]: NutrientFact;
}): { [key: string]: NutrientFact } {
  const orderedNutrientMap: { [key: string]: NutrientFact } = {};
  Object.keys(nutrientMap)
    .sort()
    .forEach((nutrientName) => {
      orderedNutrientMap[nutrientName] = nutrientMap[nutrientName];
    });
  return orderedNutrientMap;
}

/**
 * Calculate cheapest cost and nutrition for each recipe
 *
 * For each ingredient:
 * 1. Find cheapest supplier by comparing normalized costs
 * 2. Calculate nutrient contribution per 100g of recipe
 * 3. Sum all nutrient contributions
 *
 * @param recipes - Array of recipes to process
 * @returns Object with recipe names as keys and summary data as values
 */
function calculateRecipeSummary(recipes: Recipe[]): {
  [recipeName: string]: {
    cheapestCost: number;
    nutrientsAtCheapestCost: { [nutrientName: string]: NutrientFact };
  };
} {
  const summary: {
    [recipeName: string]: {
      cheapestCost: number;
      nutrientsAtCheapestCost: { [nutrientName: string]: NutrientFact };
    };
  } = {};

  for (const recipe of recipes) {
    let totalCost = 0;
    const nutrientMap: { [key: string]: NutrientFact } = {};

    // Process each ingredient
    for (const lineItem of recipe.lineItems) {
      const ingredient = lineItem.ingredient;
      const requiredUoM = lineItem.unitOfMeasure;
      const availableProducts = GetProductsForIngredient(ingredient);

      // Find cheapest supplier
      const selectedSupplier = findCheapestSupplier(
        ingredient,
        availableProducts
      );

      // Calculate cost and nutrients
      const ingredientCost = calculateNutrientContribution(
        requiredUoM,
        selectedSupplier,
        nutrientMap
      );
      totalCost += ingredientCost;
    }

    // Sort nutrients alphabetically
    const orderedNutrientMap = sortNutrientsAlphabetically(nutrientMap);

    // Store results
    summary[recipe.recipeName] = {
      cheapestCost: totalCost,
      nutrientsAtCheapestCost: orderedNutrientMap,
    };
  }

  return summary;
}

// Execute the calculation
Object.assign(recipeSummary, calculateRecipeSummary(recipeData));
/*
 * YOUR CODE ABOVE THIS, DO NOT MODIFY BELOW
 * */
RunTest(recipeSummary);
