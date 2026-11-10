// lib/parse.js
// This is the logic that used to live inside the HTML file, in plain
// view-source-able JavaScript. It now runs only on the server: the
// browser receives the finished JSON, never this code.

const ExcelJS = require('exceljs');

const RX = {
  ord: /order|ord\b|invoice|ref|^#|^id$|no\.?$/i,
  cust: /customer|client|buyer|name|consignee|recipient/i,
  addr: /address|addr|street|location|city|deliver|ship/i,
};

function exactOr(headers, exactName, fallbackRx) {
  const lower = headers.map((h) => h.toLowerCase());
  const exactIdx = lower.indexOf(exactName);
  if (exactIdx >= 0) return exactIdx;
  return headers.findIndex((h) => fallbackRx.test(h));
}

function statusClass(t) {
  if (!t) return 'mid';
  if (/undeliver|fail|error|not |cancel|reject|attempt/i.test(t)) return 'bad';
  if (/deliver|complete|success|done|^ok/i.test(t)) return 'ok';
  return 'mid';
}

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'object') {
    if (cell.richText) return cell.richText.map((r) => r.text).join('');
    if (cell.text) return String(cell.text);
    if (cell.result != null) return String(cell.result);
    if (cell.hyperlink) return String(cell.hyperlink);
  }
  return String(cell).trim();
}

async function embeddedImagesByRow(worksheet, workbook) {
  const out = {};
  try {
    const images = worksheet.getImages();
    for (const img of images) {
      const media = workbook.model.media[img.imageId];
      if (!media || !media.buffer) continue;
      const row = Math.round(img.range.tl.row) + 1; // exceljs is 0-indexed; rows below are 1-indexed
      const ext = (media.extension || 'png').toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/png';
      const b64 = Buffer.isBuffer(media.buffer) ? media.buffer.toString('base64') : Buffer.from(media.buffer).toString('base64');
      (out[row] = out[row] || []).push(`data:${mime};base64,${b64}`);
    }
  } catch (e) {
    // no embedded images / unsupported format — fine, just skip
  }
  return out;
}

/**
 * Parse an uploaded spreadsheet buffer into the order-grouped shape the
 * dashboard UI expects. Mirrors the column-detection heuristics from the
 * original client-side version, plus support for the fixed column set:
 * Order Number (within driver), Delivery Status, Customer Name,
 * Customer Address, Customer Instructions, POD Image Count,
 * POD Image URLs / POD Image 1-4 URL, Status, Attempts, Error,
 * Order Panel Text.
 */
async function parseWorkbook(buffer, sheetIndex = 0) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetNames = workbook.worksheets.map((w) => w.name);
  const worksheet = workbook.worksheets[sheetIndex] || workbook.worksheets[0];
  if (!worksheet) return { sheetNames, headers: [], orders: [] };

  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      vals.push(cellText(cell.value));
    });
    rows.push(vals);
  });

  let headerRowIdx = rows.findIndex((r) => r.filter((c) => c.trim()).length > 1);
  if (headerRowIdx < 0) headerRowIdx = 0;
  const headers = (rows[headerRowIdx] || []).map((c, i) => c.trim() || `Column ${i + 1}`);

  const is = exactOr(headers, 'order number (within driver)', /^stop|stop\s*(no|num|number|#)|^seq|within driver/i);
  const io = is >= 0 ? is : headers.findIndex((h) => RX.ord.test(h));
  const iin = exactOr(headers, 'customer instructions', /instruction|note|comment/i);
  const ids = headers.findIndex((h) => h.toLowerCase() === 'delivery status');
  const ist = exactOr(headers, 'status', /^status/i);
  const iat = headers.findIndex((h) => /^attempts?/i.test(h));
  const ier = exactOr(headers, 'error', /^error/i);
  const icn = exactOr(headers, 'pod image count', /image count|photo count|^count/i);
  const ipt = headers.findIndex((h) => /order panel text/i.test(h));
  let ic = exactOr(headers, 'customer name', RX.cust);
  const ia = exactOr(headers, 'customer address', RX.addr);
  if (ic === io) ic = headers.findIndex((h, i) => i !== io && RX.cust.test(h));

  const podCols = headers
    .map((h, i) => (/^pod image( \d+)? urls?$/i.test(h) ? i : -1))
    .filter((i) => i >= 0);

  const embedded = await embeddedImagesByRow(worksheet, workbook);

  const map = new Map();
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((c) => c.trim())) continue;

    const key = io >= 0 && row[io] && row[io].trim() ? row[io].trim() : `Row ${r + 1}`;
    let o = map.get(key);
    if (!o) {
      o = {
        id: key,
        stop: is >= 0 ? parseInt(String(row[is]).replace(/\D/g, '')) || 0 : 0,
        cust: '',
        addr: '',
        instr: '',
        dstatus: '',
        status: '',
        att: '',
        error: '',
        panel: '',
        cnt: null,
        extra: [],
        photos: [],
      };
      map.set(key, o);
    }

    const g = (i) => (i >= 0 && row[i] != null ? row[i].trim() : '');
    o.instr = o.instr || g(iin);
    o.dstatus = o.dstatus || g(ids);
    o.status = o.status || g(ist);
    o.att = o.att || g(iat);
    o.error = o.error || g(ier);
    o.panel = o.panel || g(ipt);
    if (o.cnt == null && icn >= 0) {
      const n = parseInt(row[icn]);
      o.cnt = isNaN(n) ? null : n;
    }
    if (!o.cust && ic >= 0) o.cust = row[ic];
    if (!o.addr && ia >= 0) o.addr = row[ia];

    // photo URLs — only from POD image columns, de-duplicated
    const colsToScan = podCols.length ? podCols : row.map((_, i) => i);
    for (const c of colsToScan) {
      if (podCols.length && !podCols.includes(c)) continue;
      const cellVal = row[c] || '';
      const urls = cellVal.match(/https?:\/\/[^\s,;"')]+/g) || [];
      for (const u of urls) {
        if (!o.photos.some((p) => p.url === u)) o.photos.push({ type: 'link', url: u });
      }
    }

    // embedded images anchored to this row
    const rowImgs = embedded[r + 1] || [];
    for (const dataUrl of rowImgs) {
      o.photos.push({ type: 'embedded', dataUrl });
    }
  }

  const orders = [...map.values()];
  orders.forEach((o, i) => {
    if (!o.stop) o.stop = i + 1;
    o.photoCount = o.photos.length;
    o.statusClass = statusClass(o.dstatus || o.status);
  });

  return { sheetNames, headers, orders };
}

module.exports = { parseWorkbook, statusClass };
