import { vecLength } from '@rapid-sdk/math';

import { AbstractBehavior } from './AbstractBehavior.js';
import { osmEntity, osmNode, osmWay, QAItem } from '../osm/index.js';
import { actionAddMidpoint } from '../actions/add_midpoint.js';
import { geoChooseEdge } from '../geo/index.js';
import { utilDetect } from '../util/detect.js';

const NEAR_TOLERANCE = 4;
const FAR_TOLERANCE = 12;


/**
 * `SelectBehavior` listens to pointer events and selects items that are clicked on.
 *
 * Properties available:
 *   `enabled`      `true` if the event handlers are enabled, `false` if not.
 *   `lastDown`     `eventData` Object for the most recent down event
 *   `lastUp`       `eventData` Object for the most recent up event (to detect dbl clicks)
 *   `lastMove`     `eventData` Object for the most recent move event
 *   `lastSpace`    `eventData` Object for the most recent move event used to trigger a spacebar click
 *   `lastClick`    `eventData` Object for the most recent click event
 */
export class SelectBehavior extends AbstractBehavior {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'select';

    this._multiSelection = new Set();
    this._spaceClickDisabled = false;
    this._longPressTimeout = null;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    // Make sure the event handlers have `this` bound correctly
    this._cancelLongPress = this._cancelLongPress.bind(this);
    this._doLongPress = this._doLongPress.bind(this);
    this._keydown = this._keydown.bind(this);
    this._keyup = this._keyup.bind(this);
    this._pointercancel = this._pointercancel.bind(this);
    this._pointerdown = this._pointerdown.bind(this);
    this._pointermove = this._pointermove.bind(this);
    this._pointerup = this._pointerup.bind(this);
  }


  /**
   * enable
   * Bind event handlers
   */
  enable() {
    if (this._enabled) return;

    this._enabled = true;
    this._multiSelection.clear();
    this._spaceClickDisabled = false;
    this._longPressTimeout = null;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    const eventManager = this.context.systems.gfx.events;
    eventManager.on('keydown', this._keydown);
    eventManager.on('keyup', this._keyup);
    eventManager.on('pointerdown', this._pointerdown);
    eventManager.on('pointermove', this._pointermove);
    eventManager.on('pointerup', this._pointerup);
    eventManager.on('pointercancel', this._pointercancel);
  }


  /**
   * disable
   * Unbind event handlers
   */
  disable() {
    if (!this._enabled) return;

    this._enabled = false;
    this._multiSelection.clear();
    this._spaceClickDisabled = false;
    this._longPressTimeout = null;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;

    this.lastDown = null;
    this.lastUp = null;
    this.lastMove = null;
    this.lastSpace = null;
    this.lastClick = null;

    this._cancelLongPress();

    const eventManager = this.context.systems.gfx.events;
    eventManager.off('keydown', this._keydown);
    eventManager.off('keyup', this._keyup);
    eventManager.off('pointerdown', this._pointerdown);
    eventManager.off('pointermove', this._pointermove);
    eventManager.off('pointerup', this._pointerup);
    eventManager.off('pointercancel', this._pointercancel);
  }


  /**
   * _keydown
   * Handler for keydown events on the window.
   * @param  `e`  A DOM KeyboardEvent
   */
  _keydown(e) {
    // if any key is pressed the user is probably doing something other than long-pressing
    this._cancelLongPress();

    const context = this.context;

    // Escape key
    if (['Escape', 'Esc'].includes(e.key)) {
      if (context.container().select('.combobox').size()) return;
      e.preventDefault();
      context.enter('browse');
      return;

    } else if (e.key === 'ContextMenu') {
      e.preventDefault();
      this._doContextMenu();
      return;

    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    } else if (!this._spaceClickDisabled && [' ', 'Spacebar'].includes(e.key)) {
      // ignore spacebar events during text input
      const activeNode = document.activeElement;
      if (activeNode && new Set(['INPUT', 'TEXTAREA']).has(activeNode.nodeName)) return;
      e.preventDefault();
      e.stopPropagation();
      this._spacebar();
    }
  }


  /**
   * _keyup
   * Handler for keyup events on the window.
   * @param  `e`  A DOM KeyboardEvent
   */
  _keyup(e) {
    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    if (this._spaceClickDisabled && [' ', 'Spacebar'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      this._spaceClickDisabled = false;
    }
  }


  /**
   * _pointerdown
   * Handler for pointerdown events.  Note that you can get multiples of these
   * if the user taps with multiple fingers. We lock in the first one in `lastDown`.
   * @param  `e`  A Pixi FederatedPointerEvent
   */
  _pointerdown(e) {
    if (this.lastDown) return;  // a pointer is already down

    this.context.systems.ui.closeEditMenu();
    this._showsMenu = false;

    this.context.systems.ui.closeMapRouletteMenu();
    this._showsMapRouletteMenu = false;

    const down = this._getEventData(e);
    this.lastDown = down;
    this.lastClick = null;

    this._cancelLongPress();

    // For touch devices, we want to make sure that the context menu is accessible via long press.
    if (e.pointerType === 'touch') {
      this._longPressTimeout = window.setTimeout(this._doLongPress, 750, down);
    }
  }


  /**
   * _pointermove
   * Handler for pointermove events.
   * @param  `e`  A Pixi FederatedPointerEvent
   */
  _pointermove(e) {
    const move = this._getEventData(e);
    this.lastMove = move;

    // After spacebar click, user must move pointer or lift spacebar to allow another spacebar click
    if (this._spaceClickDisabled && this.lastSpace) {
      const dist = vecLength(move.coord.screen, this.lastSpace.coord.screen);
      if (dist > FAR_TOLERANCE) {     // pointer moved far enough
        this._spaceClickDisabled = false;
      }
    }

    // If the pointer moves too much, we consider it as a drag, not a click, and set `isCancelled=true`
    const down = this.lastDown;
    if (down && !down.isCancelled && down.id === move.id) {
      const dist = vecLength(down.coord.screen, move.coord.screen);
      if (dist >= NEAR_TOLERANCE) {
        down.isCancelled = true;
      }
    }
  }


  /**
   * _pointerup
   * Handler for pointerup events.
   * @param  `e`  A Pixi FederatedPointerEvent
   */
  _pointerup(e) {
    const down = this.lastDown;
    const up = this._getEventData(e);
    if (!down || down.id !== up.id) return;  // not down, or different pointer

    this.lastDown = null;  // prepare for the next `pointerdown`

    if (down.isCancelled) return;   // was cancelled already by moving too much

    const dist = vecLength(down.coord.screen, up.coord.screen);
    const updist = vecLength(up.coord.screen, this.lastUp ? this.lastUp.coord.screen : 0);
    const lClick = up.event.button === 0;

    // Second left-click nearby, targeting the same target, within half a second of the last up event.
    // We got ourselves a double click!
    if (lClick && this.lastUp?.target?.dataID && updist < NEAR_TOLERANCE && this.lastUp?.target?.dataID === up.target?.dataID && up.time - (this.lastUp ? this.lastUp.time : 0) < 500) {
      this.lastClick = this.lastUp = up;  // We will accept this as a double-click
      this._doDoubleClick();

    } else if (dist < NEAR_TOLERANCE || (dist < FAR_TOLERANCE && up.time - down.time < 500)) {
      this.lastClick = this.lastUp = up;  // We will accept this as a click

      if (up.event.button === 2) {   // right click
        if (!this.context.selectedIDs().includes(down.target.dataID)) {
          this._doSelect();    // Select it first, if needed
        }
        const target = down.target;
        if (target && target.data && target.data.service === 'maproulette') {
          const ui = this.context.systems.ui;
          const anchorPoint = up.coord.screen;
          ui.showMapRouletteMenu(anchorPoint, 'rightclick');
        } else {
          this._doContextMenu(); // Then show the context menu.
        }

      } else {
        this._doSelect();
      }
    }
  }


  /**
   * _pointercancel
   * Handler for pointercancel events.
   * @param  `e`  A Pixi FederatedPointerEvent
   */
  _pointercancel() {
    // Here we can throw away the down data to prepare for another `pointerdown`.
    // After pointercancel, there should be no more `pointermove` or `pointerup` events.
    this.lastDown = null;
  }


  /**
   * _spacebar
   * Handler for `keydown` events of the spacebar. We use these to simulate clicks.
   * Note that the spacebar will repeat, so we can get many of these.
   */
  _spacebar() {
    if (this._spaceClickDisabled) return;

    // For spacebar clicks we will use the last move event as the trigger
    if (!this.lastMove) return;

    // Becase spacebar events will repeat if you keep it held down,
    // user must move pointer or lift spacebar to allow another spacebar click.
    // So we disable further spacebar clicks until one of those things happens.
    this._spaceClickDisabled = true;
    this.lastSpace = this.lastMove;
    this.lastClick = this.lastMove;   // We will accept this as a click
    this._doSelect();
  }


  /**
   * _doSelect
   * Once we have determined that the user has clicked, this is where we handle that click.
   */
  _doSelect() {
    if (!this._enabled || !this.lastClick) return;  // nothing to do

    this._cancelLongPress();

    const context = this.context;
    const gfx = context.systems.gfx;
    const photos = context.systems.photos;
    const eventManager = gfx.events;

    const modifiers = eventManager.modifierKeys;
    const isMac = utilDetect().os === 'mac';
    const disableSnap = modifiers.has('Alt') || modifiers.has('Meta') || (!isMac && modifiers.has('Control'));
    const isMultiselect = modifiers.has('Shift');
    const eventData = Object.assign({}, this.lastClick);  // shallow copy

    // If a modifier key is down, discard the target to prevent snap/hover.
    if (disableSnap) {
      eventData.target = null;
    }

    // Determine what we clicked on and switch modes..
    const target = eventData.target;
    let data = target?.data;
    let dataID = target?.dataID;

    // If we're clicking on something real, we want to pause doubleclick zooms
    if (data) {
      const behavior = context.behaviors.mapInteraction;
      behavior.doubleClickEnabled = false;
      window.setTimeout(() => behavior.doubleClickEnabled = true, 500);
    }

    // Clicked a midpoint..
    // Treat a click on a midpoint as if clicking on its parent way
    if (data?.type === 'midpoint') {
      data = data.way;
      dataID = data.id;
    }

    // Clicked on nothing
    if (!data) {
      if (context.mode?.id !== 'browse' && !this._multiSelection.size && !isMultiselect) {
        context.enter('browse');
      }
      return;
    }

    // Clicked a non-OSM feature..
    if (
      data.__fbid__ ||            // Clicked a Rapid feature..
      data.overture ||            // Clicked an Overture feature..
      data.__featurehash__ ||     // Clicked Custom Data (e.g. gpx track)..
      data instanceof QAItem ||   // Clicked a QA Item (OSM Note, KeepRight, Osmose, Maproulette)..
      data.type === 'detection'   // Clicked on an object detection / traffic sign..
    ) {
      const selection = new Map().set(dataID, data);
      context.enter('select', { selection: selection });
      return;
    }

    // Clicked an OSM feature..
    if (data instanceof osmEntity) {
      let selectedIDs = context.selectedIDs();

      if (!isMultiselect) {
        if (!this._showsMenu || selectedIDs.length <= 1 || !selectedIDs.includes(dataID)) {
          // Always re-enter select mode even if the entity is already
          // selected since listeners may expect `context.enter` events,
          // e.g. in the walkthrough
          context.enter('select-osm', { selection: { osm: [dataID] }} );
        }
      } else {
        if (selectedIDs.includes(dataID)) {   // already in the selectedIDs..
          if (!this._showsMenu) {
            selectedIDs = selectedIDs.filter(id => id !== dataID);      // deselect it..
            context.enter('select-osm', { selection: { osm: selectedIDs }} );
          }
        } else {                       // not already in selectedIDs...
          selectedIDs.push(dataID);    // select it..
          context.enter('select-osm', { selection: { osm: selectedIDs }} );
        }
      }
      return;
    }

    // Clicked on a photo..
    // (this highlights the photo but does not actually alter the selection)
    if (data.type === 'photo') {
      const layerID = target.layerID;
      photos.selectPhoto(layerID, dataID);
      return;
    }
  }


  /**
   * _cancelLongPress
   */
  _cancelLongPress() {
    if (!this._longPressTimeout) return;

    window.clearTimeout(this._longPressTimeout);
    this._longPressTimeout = null;
    this._showsMenu = false;
    this._showsMapRouletteMenu = false;
  }


  /**
   * _doLongPress
   * Called a short time after pointerdown.
   * If we're still down, treat it as a click + contextmenu.
   * @param  `down`  EventData Object for the original down event
   */
  _doLongPress(down) {
    this._longPressTimeout = null;

    if (this.lastDown === down && !down.isCancelled) {   // still down
      this.lastClick = down;    // We will accept this as a click
      down.isCancelled = true;  // cancel it so that we don't get *another* click when the user lifts up
      this._doSelect();
      this._doContextMenu();
    }
  }


  /**
   * _doDoubleClick
   * Once we have had two 'ups' in a row we need to see if anything special needs to be done to the entity being clicked on.
   * If it's a way or an area, we need to add a node wherever they clicked:
   * - If it's on a bare part of the way
   * - If they double clicked right on a midpoint.
   */
  _doDoubleClick() {
    if (!this._enabled || !this.lastUp) return;

    const context = this.context;
    const editor = context.systems.editor;
    const l10n = context.systems.l10n;

    const point = this.lastUp.coord.map;
    const data = this.lastUp.target?.data;

    const isOSMWay = data instanceof osmWay && !data.__fbid__;
    const isMidpoint = data.type === 'midpoint';

    let loc, edge;
    if (isOSMWay) {
      const graph = editor.staging.graph;
      const viewport = context.viewport;
      const choice = geoChooseEdge(graph.childNodes(data), point, viewport);
      loc = choice.loc;
      edge = [ data.nodes[choice.index - 1], data.nodes[choice.index] ];

    } else if (isMidpoint) {
      loc = data.loc;
      edge = [data.a.id, data.b.id];
    }

    if (loc && edge) {
      editor.perform(actionAddMidpoint({ loc: loc, edge: edge }, osmNode()));
      editor.commit({
        annotation: l10n.t('operations.add.annotation.vertex'),
        selectedIDs: context.selectedIDs()   // keep the parent way selected
      });
    }

  }

  /**
   * _doContextMenu
   * Once we have determined that the user wants the contextmenu, this is where we handle that.
   * We get into here from `_pointerup`, `_keydown`, or `_doLongPress`
   * Uses whatever is in `this.lastClick` as the target for the menu.
   */
  _doContextMenu() {
    if (!this._enabled || !this.lastClick) return;  // nothing to do

    const context = this.context;
    const eventManager = context.systems.gfx.events;
    const ui = context.systems.ui;

    const modifiers = eventManager.modifierKeys;
    const isMac = utilDetect().os === 'mac';
    const disableSnap = modifiers.has('Alt') || modifiers.has('Meta') || (!isMac && modifiers.has('Control'));
    const eventData = Object.assign({}, this.lastClick);  // shallow copy

    // If a modifier key is down, discard the target to prevent snap/hover.
    if (disableSnap) {
      eventData.target = null;
    }
    const target = eventData.target;
    const data = target?.data;
    // Check if the clicked item is a MapRoulette task
    if (data instanceof QAItem && data.service === 'maproulette') {
      const anchorPoint = eventData.coord.screen;
      if (this._showsMapRouletteMenu) {
        ui.closeMapRouletteMenu();
        this._showsMapRouletteMenu = false;
      } else {
        ui.showMapRouletteMenu(anchorPoint, 'rightclick');
        this._showsMapRouletteMenu = true;
      }
      return;
    }
    if (this._showsMenu) {   // menu is on, toggle it off
      ui.closeEditMenu();
      this._showsMenu = false;

    } else {                 // menu is off, toggle it on
      // Only attempt to display the context menu if we're focused on a non-Rapid OSM Entity.
      this._showsMenu = true;
      ui.showEditMenu(eventData.coord.map);
    }
  }

}
