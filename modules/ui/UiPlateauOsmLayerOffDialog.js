import { uiConfirm } from './confirm.js';

const HIDDEN_KEY = 'plateau.osm-layer-off-dialog.hidden';


/**
 * UiPlateauOsmLayerOffDialog
 * OSM のデータのレイヤーが消えているために PLATEAU の候補を伏せたことを、
 * 画面中央のダイアログで伝える。
 *
 * 出すかどうかの判断は `PlateauService` が持ち、この部品は `osmlayeroff` を
 * 受け取るだけ。`PlateauService` はページを開き直すまでに 1 回しか発生させない。
 *
 * 「次から表示しない」を選んだ利用者には、以後まったく出さない。
 */
export class UiPlateauOsmLayerOffDialog {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.show = this.show.bind(this);

    const plateau = context.services?.plateau;
    if (plateau) {
      plateau.on('osmlayeroff', this.show);
    }
  }


  /**
   * show
   * ダイアログを開く。「次から表示しない」を選んだ利用者には開かない。
   * @return  {d3-selection?}  開いたダイアログ。開かなかった場合は undefined
   */
  show() {
    const context = this.context;
    const storage = context.systems.storage;
    const l10n = context.systems.l10n;

    if (storage?.getItem(HIDDEN_KEY) === 'true') return;

    const $modal = uiConfirm(context, context.container());

    $modal.select('.modal-section.header')
      .append('h3')
      .text(l10n.t('plateau_conflation.osm_layer_off_title'));

    const $message = $modal.select('.modal-section.message-text');

    $message
      .append('p')
      .text(l10n.t('plateau_conflation.osm_layer_off'));

    const $label = $message
      .append('label')
      .attr('class', 'plateau-dont-show-again');

    $label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', function() {
        if (this.checked) {
          storage?.setItem(HIDDEN_KEY, 'true');
        } else {
          storage?.removeItem(HIDDEN_KEY);
        }
      });

    $label
      .append('span')
      .text(l10n.t('plateau_conflation.dont_show_again'));

    $modal.okButton();

    return $modal;
  }

}
