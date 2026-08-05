import { select, selection } from 'd3-selection';
import { marked } from 'marked';

import { actionNoop, actionRapidAcceptFeature } from '../actions/index.js';
import { uiIcon } from './icon.js';
import { uiFlash } from './flash.js';
//import { uiRapidFirstEditDialog } from './rapid_first_edit_dialog.js';
import { uiTooltip } from './tooltip.js';
import { utilCmd } from '../util/cmd.js';
import { utilKeybinding } from '../util/keybinding.js';
import { utilBuildingRelationInfo } from '../util/building_relation.js';

const ACCEPT_FEATURES_LIMIT = 50;


/**
 * UiRapidInspector
 * The RapidInspector is a UI component for viewing/editing Rapid Entities in the sidebar.
 *
 * @example
 *  <div class='rapid-inspector'>
 *    <div class='header'>…</div>
 *    <div class='body'>
 *      <div class='feature-info'/>              // Dataset name, e.g. "Microsoft Buildings"
 *      <div class='tag-info'/>                  // List of tags on this feature
 *      <div class='rapid-inspector-choices'/>   // Accept/Ignore buttons
 *    </div>
 *  </div>
 */
export class UiRapidInspector {
  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;

    this.datum = null;
    this._keys = null;
    // Need a "private" keybinding for this component because these keys conflict with
    // the main keys used by the operations when editing OSM. ('A','D','M','R')
    this._keybinding = utilKeybinding('UiRapidInspector');
    select(document).call(this._keybinding);

    // D3 selections
    this.$parent = null;
    this.$inspector = null;

    // Create child components
    this.AcceptTooltip = uiTooltip(context).placement('bottom');
    this.AcceptOnlyThisTooltip = uiTooltip(context).placement('bottom');
    this.IgnoreTooltip = uiTooltip(context).placement('bottom');

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.renderFeatureInfo = this.renderFeatureInfo.bind(this);
    this.renderTagInfo = this.renderTagInfo.bind(this);
    this.renderChoices = this.renderChoices.bind(this);
    this.renderChoice = this.renderChoice.bind(this);
    this.renderNotice = this.renderNotice.bind(this);
    this.acceptFeature = this.acceptFeature.bind(this);
    this.ignoreFeature = this.ignoreFeature.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // accept and enter one of these modes:
    this.moveFeature = (e, d) => this.acceptFeature(e, d, 'move');
    this.rotateFeature = (e, d) => this.acceptFeature(e, d, 'rotate');

    // Setup event handlers
    const l10n = context.systems.l10n;
    l10n.on('localechange', this._setupKeybinding);
    this._setupKeybinding();
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders.)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n;
    const rtl = l10n.isRTL() ? '-rtl' : '';

    let $inspector = $parent.selectAll('.rapid-inspector')
      .data([0]);

    const $$inspector = $inspector.enter()
      .append('div')
      .attr('class', 'rapid-inspector');


    // add `.header`
    const $$header = $$inspector
      .append('div')
      .attr('class', 'header');

    $$header
      .append('h3')
      .append('svg')
      .attr('class', 'logo-rapid')
      .append('use');

    $$header
      .append('button')
      .attr('class', 'rapid-inspector-close')
      .on('click', () => context.enter('browse'))
      .call(uiIcon('#rapid-icon-close'));

    // add `.body`
    $$inspector
      .append('div')
      .attr('class', 'body');

    // update
    this.$inspector = $inspector = $inspector.merge($$inspector);

    // localize logo
    $inspector.selectAll('.logo-rapid > use')
      .attr('xlink:href', `#rapid-logo-rapid-wordmark${rtl}`);

    $inspector.selectAll('.body')
      .call(this.renderFeatureInfo)
      .call(this.renderTagInfo)
      .call(this.renderChoices)
      .call(this.renderNotice);
  }


  /**
   * isAcceptFeatureDisabled
   * The "Add Feature" button is disabled if the user has already added more than the
   *  ACCEPT_FEATURES_LIMIT - unless they are working on a task, or in poweruser mode.
   * @return {boolean}  `true` if Add Feature is disabled, `false` if enabled.
   */
  isAcceptFeatureDisabled() {
    const context = this.context;
    const rapid = context.systems.rapid;
    const urlhash = context.systems.urlhash;

    // If Rapid is working with on a task, "add roads" is always enabled
    if (rapid.taskExtent) return false;

    // Power users aren't limited by the max features limit
    const isPowerUser = urlhash.getParam('poweruser') === 'true';
    if (isPowerUser) return false;

    return rapid.acceptIDs.size >= ACCEPT_FEATURES_LIMIT;
  }


  /**
   * acceptFeature
   * Called when the user presses Add Feature.
   * @param  {Event}  e?         - triggering event (if any)
   * @param  {Object} d?         - object bound to the choice (Phase 4-C: skipCascade flag を読む)
   * @param  {string} nextMode?  - optional next mode to enter after accepting ('move' or 'rotate')
   */
  acceptFeature(e, d, nextMode) {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const editor = context.systems.editor;
    const l10n = context.systems.l10n;
    const rapid = context.systems.rapid;
    const scene = context.systems.gfx.scene;

    if (this.isAcceptFeatureDisabled()) {
      const flash = uiFlash(context)
        .duration(5000)
        .label(l10n.t(
          'rapid_inspector.option_accept.disabled_flash',
          { n: ACCEPT_FEATURES_LIMIT }
        ));
      flash();
      return;
    }

    const service = context.services[datum.__service__];
    const graph = service.graph(datum.__datasetid__);
    const datasetID = datum.__datasetid__.replace('-conflated', '');
    const dataset = rapid.datasets.get(datasetID);

    // Phase 4-C: choice の skipCascade フラグを action に渡す
    const skipCascade = !!(d && d.skipCascade);
    const annotationStringID = d?.annotationStringID || 'rapid_inspector.option_accept.annotation';

    // Phase 4-B-2 (描画修正): cascade で受理した全 entity ID を集めて annotation に積む。
    // RapidSystem._stablechange がこれを読み acceptIDs に追加することで、Rapid layer が
    // cascade 全 member を即座にフィルタアウト (= 二重描画解消) する。
    const acceptedIDs = [];

    // Pass tree alongside skipCascade/acceptedIDs so the action can also
    // run upstream's auto-connect on accepted way endpoints (PR #1769).
    editor.perform(actionRapidAcceptFeature(datum.id, graph, { skipCascade, acceptedIDs, tree: editor.tree }));

    // In place of a string annotation, this introduces an "object-style"
    // annotation, where "type" and "description" are standard keys,
    // and there may be additional properties. Note that this will be
    // serialized to JSON while saving undo/redo state in editor.save().
    const annotation = {
      type: 'rapid_accept_feature',
      description: l10n.t(annotationStringID),
      entityID: datum.id,
      entityIDs: acceptedIDs.length ? acceptedIDs.slice() : undefined,
      dataUsed: dataset?.dataUsed || [datasetID]
    };

    editor.commit({ annotation: annotation, selectedIDs: [datum.id] });

    // What next
    // - If we were in select mode, stay in select mode
    // - Or, if we are passed a `nextMode` do that.
    // - Or, if the feature was hovered, keep it hovered
    const currMode = context.mode?.id || '';
    if (!nextMode && /^select/.test(currMode)) {   // if it is selected, stay selected
      nextMode = 'select-osm';
    }

    if (nextMode) {   // should be one of 'select-osm', 'move', or 'rotate'
      context.enter(nextMode, { selection: { osm: [datum.id] }} );

    } else {  // if it was hovered, hover the newly added item (this is hacky):
      // 1. get the `lastMove` event, and make it appear to target the new entity on the 'osm' layer
      // 2. tell the hover behavior to emit a new 'hoverchange' event.
      const hover = context.behaviors.hover;
      const lastMove = hover.lastMove;
      const graph = editor.staging.graph;
      const entity = graph.entity(datum.id);  // get the newly accepted entity
      const layer = scene.layers.get('osm');
      lastMove.target = {
        displayObject: null,
        feature: null,
        featureID: null,
        layer: layer,
        layerID: layer.id,
        data: entity,
        dataID: entity.id
      };
      hover._doHover();
    }

    this.datum = null;

    if (context.inIntro) return;
    if (window.sessionStorage.getItem('acknowledgedLogin') === 'true') return;
    window.sessionStorage.setItem('acknowledgedLogin', 'true');

// This dialog box looks kind of old and could use a refresh
// It it to tell new users that they need to log into OSM.
//    const osm = context.services.osm;
//    if (!osm.authenticated()) {
//      context.container()
//        .call(uiRapidFirstEditDialog(context));
//    }
  }


  /**
   * ignoreFeature
   * Called when the user presses "Ignore Feature".
   * @param  {Event}  e? - triggering event (if any)
   * @param  {Object} d? - object bound to the selection (i.e. the command) (not used)
   */
  ignoreFeature(e) {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const editor = context.systems.editor;
    const l10n = context.systems.l10n;

    // Store the GERS ID for later export
    const gersID = datum.__gersid__;
    if (gersID) {
      const rapid = context.systems.rapid;
      rapid.ignoredGersIDs.add(gersID);
    }

    const annotation = {
      type: 'rapid_ignore_feature',
      description: l10n.t('rapid_inspector.option_ignore.annotation'),
      entityID: datum.id
    };
    editor.perform(actionNoop());
    editor.commit({ annotation: annotation });
    context.enter('browse');
    this.datum = null;
  }


  /**
   * getBrightness
   * This is used to get the brightness of the given hex color.
   * (We use this to know whether text written over this color should be light or dark).
   * https://www.w3.org/TR/AERT#color-contrast
   * https://stackoverflow.com/questions/49437263/contrast-between-label-and-background-determine-if-color-is-light-or-dark/49437644#49437644
   * @param  {string} color - a hexstring like '#rgb', '#rgba', '#rrggbb', '#rrggbbaa'  (alpha values are ignored)
   * @return {number} A number representing the perceived brightness
   */
  getBrightness(color) {
    const short = (color.length < 6);
    const r = parseInt(short ? color[1] + color[1] : color[1] + color[2], 16);
    const g = parseInt(short ? color[2] + color[2] : color[3] + color[4], 16);
    const b = parseInt(short ? color[3] + color[3] : color[5] + color[6], 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000;
  }


  /**
   * renderFeatureInfo
   * Renders the 'feature-info' section (the dataset name)
   * @param {d3-selection} $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  renderFeatureInfo($selection) {
    const datum = this.datum;
    if (!datum) return;

    const context = this.context;
    const l10n = context.systems.l10n;
    const rapid = context.systems.rapid;

    const datasetID = datum.__datasetid__.replace('-conflated', '');
    const dataset = rapid.datasets.get(datasetID);
    const color = dataset.color;

    let $featureInfo = $selection.selectAll('.feature-info')
      .data([0]);

    // enter
    const $$featureInfo = $featureInfo.enter()
      .append('div')
      .attr('class', 'feature-info');

    $$featureInfo
      .append('div')
      .attr('class', 'dataset-label');

    if (dataset.beta) {
      $$featureInfo
        .append('div')
        .attr('class', 'dataset-beta beta');
    }

    // update
    $featureInfo = $featureInfo.merge($$featureInfo);

    $featureInfo
      .style('background', color)
      .style('color', this.getBrightness(color) > 140.5 ? '#333' : '#fff');

    $featureInfo.selectAll('.dataset-label')
      .text(dataset.getLabel());

    $featureInfo.selectAll('.dataset-beta')
      .attr('title', l10n.t('rapid_poweruser.beta'));   // alt text
  }


  /**
   * renderTagInfo
   * Renders the 'tag-info' section
   * @param {d3-selection} $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  renderTagInfo($selection) {
    const tags = this.datum?.tags;
    if (!tags) return;

    const context = this.context;
    const l10n = context.systems.l10n;

    let $tagInfo = $selection.selectAll('.tag-info')
      .data([0]);

    // enter
    const $$tagInfo = $tagInfo.enter()
      .append('div')
      .attr('class', 'tag-info');

    const $$tagBag = $$tagInfo
      .append('div')
      .attr('class', 'tag-bag');

    $$tagBag
      .append('div')
      .attr('class', 'tag-heading');

    for (const [k, v] of Object.entries(tags)) {
      const $$tagEntry = $$tagBag.append('div').attr('class', 'tag-entry');
      $$tagEntry.append('div').attr('class', 'tag-key').text(k);
      $$tagEntry.append('div').attr('class', 'tag-value').text(v);
    }

    // update
    $tagInfo = $tagInfo.merge($$tagInfo);

    $tagInfo.selectAll('.tag-heading')
      .text(l10n.t('rapid_inspector.tags'));
  }


  /**
   * _getBuildingRelationInfo
   * Phase 4-B-1: 現在選択中の datum が `type=building` relation のメンバー way である場合、
   * その relation の情報 (outline / parts のカウント) を返す。それ以外は null。
   *
   * @return {{relation: osmRelation, outlineCount: number, partCount: number} | null}
   */
  _getBuildingRelationInfo() {
    const datum = this.datum;
    if (!datum) return null;
    const service = this.context.services[datum.__service__];
    if (!service || typeof service.graph !== 'function') return null;
    const graph = service.graph(datum.__datasetid__);
    return utilBuildingRelationInfo(datum, graph);
  }


  /**
   * renderChoices
   * Renders the 'rapid-inspector-choices' section
   * @param {d3-selection} $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  renderChoices($selection) {
    const context = this.context;
    const l10n = context.systems.l10n;

    // Phase 4-B-1: building relation member の場合は label / description を切り替え
    // Phase 4-C: building relation member の場合は「この feature のみ追加」の opt-out を追加
    const buildingInfo = this._getBuildingRelationInfo();
    const isCourtyard = buildingInfo?.relationType === 'multipolygon';
    let acceptLabelStringID = 'rapid_inspector.option_accept.label';
    let acceptReferenceStringID = 'rapid_inspector.option_accept.description';
    if (isCourtyard) {
      acceptLabelStringID = 'rapid_inspector.option_accept_entire_courtyard_building.label';
      acceptReferenceStringID = 'rapid_inspector.option_accept_entire_courtyard_building.description';
    } else if (buildingInfo) {
      acceptLabelStringID = 'rapid_inspector.option_accept_entire_building.label';
      acceptReferenceStringID = 'rapid_inspector.option_accept_entire_building.description';
    }

    const choiceData = [
      {
        key: 'accept',
        iconName: '#rapid-icon-rapid-plus-circle',
        labelStringID: acceptLabelStringID,
        referenceStringID: acceptReferenceStringID,
        tooltip: this.AcceptTooltip,
        onClick: this.acceptFeature
      }
    ];

    // Phase 4-C: relation member 時は「この feature だけ追加」 (cascade なし) を追加。
    // ただし multipolygon では出さない。メンバー way はタグを持たないので、
    // 1 本だけ追加すると必ずタグの無い way になる。
    if (buildingInfo && !isCourtyard) {
      choiceData.push({
        key: 'accept_only_this',
        iconName: '#rapid-icon-rapid-plus-circle',
        labelStringID: 'rapid_inspector.option_accept_only_this.label',
        referenceStringID: 'rapid_inspector.option_accept_only_this.description',
        annotationStringID: 'rapid_inspector.option_accept_only_this.annotation',
        tooltip: this.AcceptOnlyThisTooltip,
        onClick: this.acceptFeature,
        skipCascade: true
      });
    }

    choiceData.push({
      key: 'ignore',
      iconName: '#rapid-icon-rapid-minus-circle',
      labelStringID: 'rapid_inspector.option_ignore.label',
      referenceStringID: 'rapid_inspector.option_ignore.description',
      tooltip: this.IgnoreTooltip,
      onClick: this.ignoreFeature
    });

    let $choices = $selection.selectAll('.rapid-inspector-choices')
      .data([0]);

    // enter
    const $$choices = $choices.enter()
      .append('div')
      .attr('class', 'rapid-inspector-choices');

    $$choices
      .append('p')
      .attr('class', 'rapid-inspector-prompt');

    // Phase 4-B-1: multi-section building info row (常時 DOM に存在させ、不要時は非表示)
    $$choices
      .append('p')
      .attr('class', 'rapid-inspector-multi-section-building-info');

    // update
    $choices = $choices.merge($$choices);

    $choices.selectAll('.rapid-inspector-prompt')
      .text(l10n.t('rapid_inspector.prompt'));

    // multi-section building 情報行: 該当時のみ表示
    //
    // type=multipolygon + building relation は inner (courtyard) 0 件でも仕様上あり得る。
    // 現状の 2 producer はどちらも実際には 0 件を送ってこない:
    //   - PLATEAU API は ring が 1 つ以下なら relation でなく単一の tagged way を出す
    //     (XML 生成側の `if len(rings) <= 1`)。
    //   - EsriService も ways.length === 1 なら単一 tagged way を返し、relation を組むのは
    //     複数 ring のときだけで、そのとき role 割り当てにより inner が最低 1 つ入る。
    // それでも「0 courtyards」という文言はナンセンスなので、この行だけは防御的に非表示にする。
    // isCourtyard 自体は partCount に依存させない (acceptOnlyThis の抑制に使われるため)。
    const $multiInfo = $choices.selectAll('.rapid-inspector-multi-section-building-info');
    const partCount = buildingInfo?.partCount;
    const hideAsEmptyCourtyard = isCourtyard && partCount === 0;
    if (buildingInfo && !hideAsEmptyCourtyard) {
      const infoStringID = isCourtyard
        ? 'rapid_inspector.courtyard_building_info'
        : 'rapid_inspector.multi_section_building_info';
      $multiInfo
        .style('display', null)
        .text(l10n.t(infoStringID, { n: partCount }));
    } else {
      $multiInfo
        .style('display', 'none')
        .text('');
    }

    // Phase 4-C: choice の出入り (relation 文脈で 2→3 ボタン化) に対応する
    // enter / update / exit パターン。labelStringID 切り替えと併せて毎回データ更新。
    const $choiceItems = $choices.selectAll('.rapid-inspector-choice')
      .data(choiceData, d => d.key);

    $choiceItems.exit().remove();

    $choiceItems.enter()
      .append('div')
      .attr('class', d => `rapid-inspector-choice rapid-inspector-choice-${d.key}`)
      .merge($choiceItems)
      .each(this.renderChoice);
  }



  /**
   * renderNotice
   * Renders the 'rapid-inspector-notice' section
   * This section contains remarks about the data - license, usage, or other hints
   * @param {d3-selection} $selection - A d3-selection to a HTMLElement that this content should render itself into
   */
  renderNotice($selection) {
    const context = this.context;
    const l10n = context.systems.l10n;
    const rapid = context.systems.rapid;
    const datum = this.datum;
    if (!datum) return;

    const datasetID = datum.__datasetid__.replace('-conflated', '');
    const dataset = rapid.datasets.get(datasetID);

    // Only display notice data for open data (for now)
    if (dataset.tags.has('opendata') && dataset.licenseUrl) {
      let $notice = $selection.selectAll('.rapid-inspector-notice')
        .data([0]);

      // enter
      const $$notice = $notice.enter()
        .append('div')
        .attr('class', 'rapid-inspector-notice');

      // update
      $notice = $notice.merge($$notice);

      $notice
        .html(marked.parse(l10n.t('rapid_inspector.notice.open_data', { url: dataset.licenseUrl })));

      $notice.selectAll('a')   // links in markdown should open in new page
        .attr('target', '_blank');
    }

  }



  /**
   * renderChoice
   * Renders a choice - This should be called within a d3-selection.each
   * @param  {*}         d - bound datum
   * @param  {number}    i - iterator
   * @param  {NodeList}  nodes - the nodes in the selection
   */
  renderChoice(d, i, nodes) {
    let $choice = select(nodes[i]);

    const context = this.context;
    const l10n = context.systems.l10n;

    const isDisabled = (d.key === 'accept' && this.isAcceptFeatureDisabled());

    // .choice-wrap
    let $choiceWrap = $choice.selectAll('.choice-wrap')
      .data([d]);

    // enter
    const $$choiceWrap = $choiceWrap.enter()
      .append('div')
      .attr('class', 'choice-wrap');

    // action button
    const $$choiceActionButton = $$choiceWrap
      .append('button')
      .attr('class', 'choice-button')
      .on('click', d.onClick)
      .call(d.tooltip);

    $$choiceActionButton
      .append('svg')
      .attr('class', 'choice-icon icon')
      .append('use')
      .attr('xlink:href', d.iconName);

    $$choiceActionButton
      .append('div')
      .attr('class', 'choice-label');

    // reference button
    $$choiceWrap
      .append('button')
      .attr('class', 'tag-reference-button')
      .attr('tabindex', '-1')
      .on('click', (e) => {
        e.currentTarget.blur();
        const $tagReference = $choice.selectAll('.tag-reference-body');
        $tagReference.classed('expanded', !$tagReference.classed('expanded'));
      })
      .call(uiIcon('#rapid-icon-inspect'));


    // update
    $choiceWrap = $choiceWrap.merge($$choiceWrap);

    $choiceWrap.selectAll('button')
      .classed('secondary', isDisabled)
      .classed('disabled', isDisabled);

    $choiceWrap.selectAll('.choice-label')
      .text(l10n.t(d.labelStringID));

    $choiceWrap.selectAll('.tag-reference-button')
      .attr('title', l10n.t('icons.information'));  // localize alt text

    // localize tooltip
    let title, shortcut;
    if (d.key === 'accept') {
      if (isDisabled) {
        title = l10n.t('rapid_inspector.option_accept.disabled', { n: ACCEPT_FEATURES_LIMIT } );
        shortcut = '';
      } else {
        title = l10n.t('rapid_inspector.option_accept.tooltip');
        shortcut = l10n.t('shortcuts.command.accept_feature.key');
      }
    } else if (d.key === 'accept_only_this') {
      title = l10n.t('rapid_inspector.option_accept_only_this.tooltip');
      // utilCmd.display renders the platform-correct modifier glyph (⇧ / Shift)
      shortcut = utilCmd.display(this.context, '⇧' + l10n.t('shortcuts.command.accept_feature.key'));
    } else if (d.key === 'ignore') {
      title = l10n.t('rapid_inspector.option_ignore.tooltip');
      shortcut = l10n.t('shortcuts.command.ignore_feature.key');
    }

    d.tooltip.title(title).shortcut(shortcut);


    // .tag-reference-body
    let $tagReference = $choice.selectAll('.tag-reference-body')
      .data([d]);

    // enter
    const $$tagReference = $tagReference.enter()
      .append('div')
      .attr('class', 'tag-reference-body');

    // update
    $tagReference = $tagReference.merge($$tagReference);

    $tagReference
      .text(l10n.t(d.referenceStringID));
  }


  /**
   * _setupKeybinding
   * This sets up the keybinding, replacing existing if needed
   */
  _setupKeybinding() {
    const context = this.context;
    const keybinding = this._keybinding;
    const l10n = context.systems.l10n;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    const acceptKey = l10n.t('shortcuts.command.accept_feature.key');
    const acceptOnlyThisKey = utilCmd('⇧' + acceptKey);  // Shift+A
    const ignoreKey = l10n.t('shortcuts.command.ignore_feature.key');
    const moveKey = l10n.t('shortcuts.command.move.key');
    const rotateKey = l10n.t('shortcuts.command.rotate.key');
    this._keys = [acceptKey, acceptOnlyThisKey, ignoreKey, moveKey, rotateKey];

    keybinding.on(acceptKey, this.acceptFeature);
    // Shift+A → Add Only This Feature. Only meaningful on multi-section
    // building parts (UiRapidInspector renders the opt-out button only then);
    // on regular features acceptFeature ignores skipCascade because there is
    // nothing to cascade in the first place, so the binding is harmless.
    keybinding.on(acceptOnlyThisKey, (e) => {
      this.acceptFeature(e, {
        skipCascade: true,
        annotationStringID: 'rapid_inspector.option_accept_only_this.annotation'
      });
    });
    keybinding.on(ignoreKey, this.ignoreFeature);
    keybinding.on(moveKey, this.moveFeature);
    keybinding.on(rotateKey, this.rotateFeature);
  }

}
