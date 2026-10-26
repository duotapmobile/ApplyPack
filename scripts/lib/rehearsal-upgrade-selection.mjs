export const REHEARSAL_TARGET_VERSION = "202610250100";
export const REHEARSAL_PREDECESSORS = Object.freeze([
  "202610040080", "202610190081", "202610190082", "202610190083", "202610190084",
  "202610220085", "202610230086", "202610240087", "202610250088", "202610250089",
  "202610250090", "202610250091", "202610250092", "202610250093", "202610250094",
  "202610250095", "202610250096", "202610250097", "202610250098", "202610250099",
]);

/** The selector partitions existing assertions; it never chooses a database,
 * changes the target schema, or skips a stage within the selected upgrade. */
export function selectRehearsalPredecessors(args) {
  if (!Array.isArray(args)) throw new Error("REHEARSAL_UPGRADE_SELECTION_INVALID");
  if (args.length === 0) return [...REHEARSAL_PREDECESSORS];
  if (args.length !== 2 || args[0] !== "--predecessor" || !REHEARSAL_PREDECESSORS.includes(args[1])) {
    throw new Error("REHEARSAL_UPGRADE_SELECTION_INVALID");
  }
  return [args[1]];
}
