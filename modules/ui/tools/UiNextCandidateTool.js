import { selection, select } from 'd3-selection';
import throttle from 'lodash-es/throttle.js';

import { uiIcon } from '../icon.js';
import { uiTooltip } from '../tooltip.js';
import { utilPlateauCandidateStatus } from '../../util/plateau_candidates.js';


// 押せないときの理由と、説明に出す文言の対応
const REASON_STRINGS = {
  'layer-off': 'toolbar.next_candidate.layer_off',
  'zoom': 'toolbar.next_candidate.zoom',
  'osm-layer-off': 'toolbar.next_candidate.osm_layer_off',
  'none': 'rapid_inspector.next_candidate.none'
};


/**
 * UiNextCandidateTool
 * 画面の中の次の Plateau の候補を選ぶボタン。`4` キーと同じく
 * `UiRapidInspector.selectNextCandidate()` を呼ぶ。
 * 押せるかどうかと名前に付ける数は `utilPlateauCandidateStatus` から得る。
 * 数え直しは地図の `draw` で行い、250ms に 1 回までに間引く。
 */
export class UiNextCandidateTool {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.id = 'next_candidate';
    this.stringID = 'toolbar.next_candidate.label';

    // 直近に数えた結果
    this._lastStatus = null;

    // Create child components
    this.Tooltip = uiTooltip(context)
      .title(() => this._tooltipText())
      .shortcut('4');

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this.label = this.label.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.throttledRender = throttle(this.rerender, 250, { leading: false });

    // Event listeners
    context.systems.map?.on('draw', this.throttledRender);
  }


  /**
   * _status
   * 押せるかどうかと候補の数を数える。テストでは差し替えられる。
   * @return {{reason: string, count: number}}
   */
  _status() {
    return utilPlateauCandidateStatus(this.context);
  }


  /**
   * _tooltipText
   * @return {string}  ボタンの説明。押せないときはその理由
   */
  _tooltipText() {
    const l10n = this.context.systems.l10n;
    const status = this._lastStatus ?? this._status();
    const stringID = REASON_STRINGS[status.reason] ?? 'toolbar.next_candidate.tooltip';
    return l10n.t(stringID);
  }


  /**
   * label
   * ツールバーの名前。押せて候補があるときは数を付ける。
   * @return {string}
   */
  label() {
    const l10n = this.context.systems.l10n;
    const status = this._lastStatus ?? this._status();
    return (status.reason === 'ok')
      ? l10n.t('toolbar.next_candidate.label_count', { n: status.count })
      : l10n.t(this.stringID);
  }


  /**
   * choose
   * @param  {Event}  e? - triggering event (if any)
   */
  choose(e) {
    if (e) e.preventDefault();
    if (this._lastStatus?.reason !== 'ok') return;   // 押せない

    this.context.systems.ui?.Sidebar?.RapidInspector?.selectNextCandidate();
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    this._lastStatus = this._status();
    const isDisabled = (this._lastStatus.reason !== 'ok');

    this.Tooltip
      .placement('bottom')
      .scrollContainer(context.container().select('.map-toolbar'));

    let $button = $parent.selectAll('button.next-candidate')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'bar-button next-candidate')
      .on('click', this.choose)
      .call(this.Tooltip)
      .call(uiIcon('#fas-forward-step'));

    // update
    $button = $button.merge($$button)
      .classed('disabled', isDisabled)
      .attr('aria-disabled', isDisabled ? 'true' : 'false');

    // 表示中の説明も理由に合わせて更新する
    if (!$button.select('.tooltip.in').empty()) {
      $button.call(this.Tooltip.updateContent);
    }

    // 名前は動的に変わるので、ツールバーの名前の欄を書き換える
    const $item = select($parent.node().parentNode);
    $item.select('.item-label').text(this.label());
    context.systems.ui?.checkOverflow('.map-toolbar', true);
  }
}
