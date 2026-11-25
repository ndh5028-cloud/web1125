(() => {
  "use strict";

  const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
  const xlsxType = contentType + "sheet";
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const style = { regular: 0, heading: 1, amount: 2, total: 3, date: 4, wrapped: 5 };

  const parts = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="${xlsxType}.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${contentType}worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="${contentType}styles+xml"/>
    </Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${relationship}/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${spreadsheet}" xmlns:r="${relationship}">
      <bookViews><workbookView/></bookViews>
      <sheets><sheet name="출장여비" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${relationship}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${relationship}/styles" Target="styles.xml"/>
    </Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${spreadsheet}">
      <numFmts count="2">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
        <numFmt numFmtId="165" formatCode="#,##0"/>
      </numFmts>
      <fonts count="2">
        <font><sz val="11"/><name val="맑은 고딕"/></font>
        <font><b/><sz val="11"/><name val="맑은 고딕"/></font>
      </fonts>
      <fills count="3">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFEAF5F0"/><bgColor indexed="64"/></patternFill></fill>
      </fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="6">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
        <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="165" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`,
  };

  function escapeXml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function sheetRow(index, cells) {
    const grid = cells.map(([value, cellStyle = style.regular], column) => {
      const address = "ABC"[column] + index;
      const attributes = `r="${address}" s="${cellStyle}"`;
      if (typeof value === "number") return `<c ${attributes}><v>${value}</v></c>`;
      return `<c ${attributes} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    });
    return `<row r="${index}">${grid.join("")}</row>`;
  }

  function dateCell(date) {
    if (date < "1900-01-01") return [date];
    // Excel reserves serial 60 for the nonexistent February 29, 1900.
    const epoch = date < "1900-03-01" ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const serial = (Date.parse(date + "T00:00:00Z") - epoch) / 86_400_000;
    return [serial, style.date];
  }

  function makeWorksheet({ start, end, tripType, daysLabel, days, total, entries, note }) {
    const rows = [
      [["국내 출장여비 계산 결과", style.heading]],
      [["출장 유형"], [tripType]],
      [["출장일"], dateCell(start)],
      [["복귀일"], dateCell(end)],
      [[daysLabel], [days]],
      [["지급 예상 합계 (원)", style.heading], [total, style.total], ["", style.heading]],
      [],
      [["항목", style.heading], ["금액 (원)", style.heading], ["산정 내역", style.heading]],
      ...entries.map(({ label, amount, detail }) => [[label], [amount, style.amount], [detail, style.wrapped]]),
    ];
    if (note) rows.push([["참고"], [""], [note, style.wrapped]]);

    return `<worksheet xmlns="${spreadsheet}">
      <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
      <cols>
        <col min="1" max="1" width="34" customWidth="1"/>
        <col min="2" max="2" width="22" customWidth="1"/>
        <col min="3" max="3" width="60" customWidth="1"/>
      </cols>
      <sheetData>${rows.map((cells, index) => sheetRow(index + 1, cells)).join("")}</sheetData>
      <mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>
    </worksheet>`;
  }

  function createBlob(exportData) {
    const zip = new globalThis.JSZip();
    for (const [path, contents] of Object.entries(parts)) zip.file(path, xmlHeader + contents);
    zip.file("xl/worksheets/sheet1.xml", xmlHeader + makeWorksheet(exportData));
    return zip.generateAsync({ type: "blob", mimeType: xlsxType, compression: "DEFLATE" });
  }

  globalThis.TravelExcel = { createBlob };
})();
