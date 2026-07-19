// The parent PLATEAU import convention asks for both of these on the changeset:
//   https://wiki.openstreetmap.org/wiki/MLIT_PLATEAU/imports_outline
// `source_ref` is what makes the provenance traceable, so naming MLIT_PLATEAU
// without it would satisfy only half the convention.
export const PLATEAU_SOURCE = 'MLIT_PLATEAU';
export const PLATEAU_TOOL_SOURCE = 'RapiD_Plateau_JP';
export const PLATEAU_SOURCE_REF = 'https://wiki.openstreetmap.org/wiki/MLIT_PLATEAU/imports_outline';


/**
 * utilApplyPlateauSourceTags
 *
 * Records that an edit used PLATEAU data, on the changeset tags.
 *
 * Two values, because they answer different questions: `MLIT_PLATEAU` is where
 * the data came from (what the import convention asks for), `RapiD_Plateau_JP`
 * is which tool made the edit. Joining is left to the caller, which already
 * joins the whole source set with ';'.
 *
 * Mutates both arguments. Safe to call repeatedly — the commit panel re-runs
 * its tag update on every render, not just the first.
 *
 * @param {Set<string>} sources - the changeset `source` values being assembled
 * @param {Object}      tags    - the changeset tags, for `source_ref`
 */
export function utilApplyPlateauSourceTags(sources, tags) {
  sources.add(PLATEAU_SOURCE);
  sources.add(PLATEAU_TOOL_SOURCE);

  // Don't overwrite a source_ref the user typed; only fill in our own.
  if (!tags.source_ref) {
    tags.source_ref = PLATEAU_SOURCE_REF;
  }
}


/**
 * utilClearPlateauSourceRef
 *
 * Removes the `source_ref` this module set, for when the edit no longer uses
 * PLATEAU data (the user undid the transfer). Leaves any other value alone --
 * a `source_ref` we did not write is the user's, not ours to delete.
 *
 * @param {Object} tags - the changeset tags
 */
export function utilClearPlateauSourceRef(tags) {
  if (tags.source_ref === PLATEAU_SOURCE_REF) {
    delete tags.source_ref;
  }
}
