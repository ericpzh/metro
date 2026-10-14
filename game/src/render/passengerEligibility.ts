interface PassengerAgeMetadata { bag: boolean; hair: string; childEligible?: boolean; adultEligible?: boolean }

/** Older approved atlases predate explicit age flags. Keep their reviewed pools
 * usable during an asset/schema update; explicit false always takes precedence. */
export function passengerEligible(model: PassengerAgeMetadata, age: 'adult' | 'child'): boolean {
  return age === 'child' ? model.childEligible ?? (!model.bag && model.hair !== 'bald') : model.adultEligible ?? true
}
