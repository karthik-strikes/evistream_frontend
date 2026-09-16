/**
 * Self-check for reading a spliced figure-table row back into labelled values.
 *
 *   node --experimental-strip-types --import ./lib/__checks__/register-alias.mjs \
 *        lib/__checks__/figureQuote.check.mts
 *
 * The case that motivated all of this is pinned first: the literal quote a
 * reviewer saw on screen, `6 | 2.5 | 2.0 | 1.5 | 0.5`, shown under the label
 * "Inferred · not a direct quote". It is neither inferred nor unreadable — it
 * is a verbatim row of the digitized table for Figure 2, and against that
 * figure's columns it is five labelled numbers.
 *
 * Also pinned: findBlockByImageFile reports `kind: 'image'`, which is what
 * stops the viewer calling a structural 1.0 join "Verbatim".
 */

import {
  alignRowToColumns,
  isHeaderRow,
  labelFigureQuote,
  parsePipeRow,
  parsePipeRows,
} from '../figureQuote.ts';
import { findBlockByImageFile, findQuoteInBlocks, type FlatBlock } from '../blockIndex.ts';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
  } else {
    console.log(`  ok    ${name}`);
  }
}

const COLUMNS = ['Hour', 'NS 440', 'APAP 1000', 'Placebo', 'Difference'];

console.log('\nparsePipeRow');
check('the reported row parses to five cells',
  JSON.stringify(parsePipeRow('6 | 2.5 | 2.0 | 1.5 | 0.5')) ===
  JSON.stringify(['6', '2.5', '2.0', '1.5', '0.5']));
check('outer pipes are accepted too',
  JSON.stringify(parsePipeRow('| 6 | 2.5 | 2.0 | 1.5 | 0.5 |')) ===
  JSON.stringify(['6', '2.5', '2.0', '1.5', '0.5']));
check('a separator row is not data', parsePipeRow('|---|---|---|') === null);
check('a separator row with colons is not data', parsePipeRow('| :--- | ---: |') === null);
check('prose is not a table row', parsePipeRow('Pain relief was greater.') === null);
check('one pipe is not enough', parsePipeRow('a | b') === null);
check('empty is null', parsePipeRow('   ') === null);

console.log('\nalignRowToColumns');
check('arity match labels every cell',
  JSON.stringify(alignRowToColumns(['6', '2.5', '2.0', '1.5', '0.5'], COLUMNS)) ===
  JSON.stringify([
    { label: 'Hour', value: '6' },
    { label: 'NS 440', value: '2.5' },
    { label: 'APAP 1000', value: '2.0' },
    { label: 'Placebo', value: '1.5' },
    { label: 'Difference', value: '0.5' },
  ]));
check('arity mismatch refuses rather than guessing',
  alignRowToColumns(['6', '2.5'], COLUMNS) === null);
check('no columns means no alignment',
  alignRowToColumns(['6', '2.5'], undefined) === null);

console.log('\nisHeaderRow');
check('the header row is recognised',
  isHeaderRow(['Hour', 'NS 440', 'APAP 1000', 'Placebo', 'Difference'], COLUMNS));
check('case does not matter',
  isHeaderRow(['hour', 'ns 440', 'apap 1000', 'placebo', 'difference'], COLUMNS));
check('a data row is not a header',
  !isHeaderRow(['6', '2.5', '2.0', '1.5', '0.5'], COLUMNS));

console.log('\nlabelFigureQuote');
const one = labelFigureQuote('6 | 2.5 | 2.0 | 1.5 | 0.5', COLUMNS);
check('the reported quote yields one row of five labelled cells',
  one !== null && one.length === 1 && one[0].length === 5 && one[0][1].label === 'NS 440'
  && one[0][1].value === '2.5');

const multi = labelFigureQuote(
  '| Hour | NS 440 | APAP 1000 | Placebo | Difference |\n| 6 | 2.5 | 2.0 | 1.5 | 0.5 |\n| 8 | 2.1 | 1.8 | 1.2 | 0.3 |',
  COLUMNS,
);
check('a quoted header is dropped, data rows kept',
  multi !== null && multi.length === 2 && multi[0][0].value === '6' && multi[1][0].value === '8');

check('a quote spanning prose refuses', labelFigureQuote('Pain relief was greater.', COLUMNS) === null);
check('arity mismatch refuses end-to-end', labelFigureQuote('6 | 2.5 | 2.0', COLUMNS) === null);
check('no columns refuses', labelFigureQuote('6 | 2.5 | 2.0 | 1.5 | 0.5', undefined) === null);
check('header alone yields nothing to show',
  labelFigureQuote('| Hour | NS 440 | APAP 1000 | Placebo | Difference |', COLUMNS) === null);

console.log('\nQuoteMatch.kind');
const blocks: FlatBlock[] = [
  {
    id: '/page/3/Figure/14', pageId: 3, pageWidth: 1148, pageHeight: 1484,
    bbox: { x0: 117, y0: 930, x1: 541, y1: 1205 }, blockType: 'Figure',
    imageFiles: ['f2_img.jpg'], text: '',
  },
  {
    id: '/page/3/Text/15', pageId: 3, pageWidth: 1148, pageHeight: 1484,
    bbox: { x0: 100, y0: 200, x1: 500, y1: 260 }, blockType: 'Text',
    text: 'Pain relief was significantly greater with naproxen sodium.',
  },
];
const byImage = findBlockByImageFile(blocks, 'f2_img.jpg');
check('an image-file join reports kind image', byImage?.kind === 'image');
check('an image-file join returns the figure block', byImage?.block.blockType === 'Figure');
check('a missing image yields null', findBlockByImageFile(blocks, 'nope.jpg') === null);

const byText = findQuoteInBlocks(blocks, 'Pain relief was significantly greater');
check('a text match reports kind text', byText?.kind === 'text');

console.log(
  failures === 0
    ? '\nAll figure-quote checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
