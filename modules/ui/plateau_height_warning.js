/**
 * uiPlateauHeightWarning
 * PLATEAU の建物の高さの警告を、見出し、理由の一覧、確かめ方の一文として描く。
 * Rapid の追加の欄とタグ転記の欄の両方で使う。
 * 描き直しのたびに作り直すので、古い欄は残らない。
 *
 * @param {d3-selection} $parent   描く先
 * @param {string[]}     messages  `utilPlateauHeightWarningMessages` の結果
 * @param {Object}       l10n      翻訳の仕組み
 * @param {string?}      before    この CSS セレクタの要素の前に置く
 */
export function uiPlateauHeightWarning($parent, messages, l10n, before) {
  $parent.selectAll('.plateau-height-warning').remove();
  if (!messages?.length) return;

  const $warning = before
    ? $parent.insert('div', before)
    : $parent.append('div');

  $warning
    .attr('class', 'plateau-height-warning')
    .attr('role', 'alert');

  $warning.append('p')
    .attr('class', 'plateau-height-warning-title')
    .text(l10n.t('plateau_height_warning.title'));

  const $list = $warning.append('ul');
  for (const message of messages) {
    $list.append('li').text(message);
  }

  $warning.append('p')
    .attr('class', 'plateau-height-warning-advice')
    .text(l10n.t('plateau_height_warning.advice'));
}
