// The "Files" tab of Library Info: the physical file inventory (every scanned
// file by original Drive location, primary vs duplicate). Viewable by any
// approved user (the hook already gates that).
import { fileInventory } from '$lib/server/inventory';

export function load() {
  return { inventory: fileInventory() };
}
