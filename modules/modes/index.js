import { AbstractMode } from './AbstractMode.js';
import { AddNoteMode } from './AddNoteMode.js';
import { AddPointMode } from './AddPointMode.js';
import { BrowseMode } from './BrowseMode.js';
import { DragNodeMode } from './DragNodeMode.js';
import { DragNoteMode } from './DragNoteMode.js';
import { DrawAreaMode } from './DrawAreaMode.js';
import { DrawLineMode } from './DrawLineMode.js';
import { HeightTransferMode } from './HeightTransferMode.js';
import { MoveMode } from './MoveMode.js';
import { RotateMode } from './RotateMode.js';
import { SaveMode } from './SaveMode.js';
import { SelectMode } from './SelectMode.js';
import { SelectOsmMode } from './SelectOsmMode.js';

export {
  AbstractMode,
  AddNoteMode,
  AddPointMode,
  BrowseMode,
  DragNodeMode,
  DragNoteMode,
  DrawAreaMode,
  DrawLineMode,
  HeightTransferMode,
  MoveMode,
  RotateMode,
  SaveMode,
  SelectMode,
  SelectOsmMode   // someday, single select mode?
};


// At init time, we will instantiate any that are in the 'available' collection.
// Note: `HeightTransferMode` is intentionally NOT registered here. It isn't an
// exclusive editing mode swapped in via `context.enter()` -- it needs to run
// alongside whatever mode (browse/select/draw) the user is actually in. It's
// registered as `context.systems.heightTransfer` instead (see modules/core/index.js).
export const modes = {
  available: new Map()   // Map (id -> Mode constructor)
};

modes.available.set('add-note', AddNoteMode);
modes.available.set('add-point', AddPointMode);
modes.available.set('browse', BrowseMode);
modes.available.set('drag-node', DragNodeMode);
modes.available.set('drag-note', DragNoteMode);
modes.available.set('draw-area', DrawAreaMode);
modes.available.set('draw-line', DrawLineMode);
modes.available.set('move', MoveMode);
modes.available.set('rotate', RotateMode);
modes.available.set('save', SaveMode);
modes.available.set('select', SelectMode);
modes.available.set('select-osm', SelectOsmMode);
