/**
 * In-memory spatial data exporters for Google Maps entities.
 * Generates formatted Excel (.xlsx), RFC 7946 GeoJSON, OGC KML 2.2, and RFC 4180 CSV Blobs.
 */

import * as XLSX from 'xlsx';
import type { ScrapedPlaceRecord, ExcelPlaceRow, RawDiagnosticDump } from '../types/places';

export class SpatialDataExporters {
  /**
   * Generates a fully formatted Excel (.xlsx) workbook with all extractable place attributes,
   * auto-fitted column widths, and an Audit Summary worksheet.
   */
  public static toExcel(items: ScrapedPlaceRecord[], defaultListName = 'Google Maps Saved Places'): Blob {
    const rows: ExcelPlaceRow[] = items.map((item) => {
      const precisionText = item.isHighPrecision
        ? 'High-Precision Pin (!3d/!4d)'
        : 'Viewport Camera (@lat,lng)';

      const coordString = `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`;
      const status = item.operationalStatus || 'Operational';
      const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        item.title
      )}&query_place_id=${item.placeId || ''}`;

      return {
        'Pin / Place Title': item.title || 'Unnamed Pin',
        'Latitude': item.latitude,
        'Longitude': item.longitude,
        'Coordinates (Lat, Lng)': coordString,
        'Precision Tier': precisionText,
        'Google Place ID': item.placeId || '',
        'Hex Feature ID': item.featureId || '',
        'CID Number': item.cid || '',
        'List Name': item.listTitle || defaultListName,
        'List ID': item.listId || '',
        'List Type': item.listType || 'custom',
        'Personal User Note': item.userNote || '',
        'Full Address': item.address || '',
        'Place Category': item.category || '',
        'Phone Number': item.phoneNumber || '',
        'Website URL': item.websiteUrl || '',
        'Rating Score': item.rating != null ? item.rating : '',
        'Review Count': item.reviewCount != null ? item.reviewCount : '',
        'Price Level': item.priceLevel || '',
        'Operational Status': status,
        'Date Added to List': item.dateAddedToList || '',
        'Extraction Timestamp': item.extractedAt || new Date().toISOString(),
        'Google Maps URL': item.url || '',
        'Direct Search Query URL': searchUrl,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Auto-fit column widths based on maximum content length
    if (rows.length > 0) {
      const columnKeys = Object.keys(rows[0]) as (keyof ExcelPlaceRow)[];
      worksheet['!cols'] = columnKeys.map((key) => {
        const headerLen = key.length;
        const maxValLen = Math.max(
          ...rows.map((row) => String(row[key] ?? '').length)
        );
        const wch = Math.min(Math.max(headerLen, maxValLen) + 3, 60);
        return { wch };
      });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Saved Places & Pins');

    // Audit Summary Sheet
    const summaryData = [
      { Metric: 'Total Pins / Places Harvested', Value: items.length },
      { Metric: 'Export Timestamp', Value: new Date().toISOString() },
      { Metric: 'High-Precision Pin Markers (!3d/!4d)', Value: items.filter((i) => i.isHighPrecision).length },
      { Metric: 'Viewport Center Fallbacks (@lat,lng)', Value: items.filter((i) => !i.isHighPrecision).length },
      { Metric: 'Places With Personal User Notes', Value: items.filter((i) => !!i.userNote).length },
      { Metric: 'Places With Verified Place ID', Value: items.filter((i) => !!i.placeId).length },
      { Metric: 'Target List Name', Value: items[0]?.listTitle || defaultListName },
      { Metric: 'Export Engine', Value: 'GMaps-RW Production v1.0.0' },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 42 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Audit Summary');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  /**
   * Generates an RFC 7946 compliant GeoJSON FeatureCollection Blob.
   */
  public static toGeoJSON(items: ScrapedPlaceRecord[]): Blob {
    const featureCollection = {
      type: 'FeatureCollection',
      features: items.map((item) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          // RFC 7946 specifies longitude first, then latitude: [lng, lat]
          coordinates: [item.longitude, item.latitude],
        },
        properties: {
          id: item.id,
          title: item.title,
          url: item.url,
          address: item.address || null,
          category: item.category || null,
          userNote: item.userNote || null,
          listId: item.listId || null,
          listTitle: item.listTitle || null,
          placeId: item.placeId || null,
          featureId: item.featureId || null,
          cid: item.cid || null,
          phoneNumber: item.phoneNumber || null,
          websiteUrl: item.websiteUrl || null,
          rating: item.rating ?? null,
          reviewCount: item.reviewCount ?? null,
          priceLevel: item.priceLevel || null,
          isHighPrecision: item.isHighPrecision,
          operationalStatus: item.operationalStatus || 'Operational',
          dateAddedToList: item.dateAddedToList || null,
          exportedAt: new Date().toISOString(),
        },
      })),
    };

    const serialized = JSON.stringify(featureCollection, null, 2);
    return new Blob([serialized], { type: 'application/geo+json;charset=utf-8' });
  }

  /**
   * Generates an OGC KML 2.2 schema compliant XML document Blob.
   */
  public static toKML(items: ScrapedPlaceRecord[], documentName = 'Google Maps Export'): Blob {
    const sanitize = (text: string) =>
      text.replace(/[<>&'"]/g, (char) => {
        switch (char) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return char;
        }
      });

    const placemarks = items
      .map(
        (item) => `    <Placemark>
      <name>${sanitize(item.title)}</name>
      <description>${sanitize(item.userNote ? `Note: ${item.userNote}\n${item.address || ''}` : item.address || item.url)}</description>
      <ExtendedData>
        <Data name="Place_ID"><value>${sanitize(item.placeId || '')}</value></Data>
        <Data name="Feature_ID"><value>${sanitize(item.featureId || '')}</value></Data>
        <Data name="CID"><value>${sanitize(item.cid || '')}</value></Data>
        <Data name="User_Note"><value>${sanitize(item.userNote || '')}</value></Data>
        <Data name="List_Name"><value>${sanitize(item.listTitle || '')}</value></Data>
        <Data name="Address"><value>${sanitize(item.address || '')}</value></Data>
        <Data name="Category"><value>${sanitize(item.category || '')}</value></Data>
        <Data name="Date_Added"><value>${sanitize(item.dateAddedToList || '')}</value></Data>
        <Data name="Precision"><value>${item.isHighPrecision ? 'Sub-meter Pin' : 'Viewport Camera'}</value></Data>
        <Data name="Source_URL"><value>${sanitize(item.url)}</value></Data>
      </ExtendedData>
      <Point>
        <coordinates>${item.longitude},${item.latitude},0</coordinates>
      </Point>
    </Placemark>`
      )
      .join('\n');

    const kmlDocument = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${sanitize(documentName)}</name>
    <open>1</open>
${placemarks}
  </Document>
</kml>`;

    return new Blob([kmlDocument], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  }

  /**
   * Generates an RFC 4180 compliant CSV document Blob with all extractable fields.
   */
  public static toCSV(items: ScrapedPlaceRecord[]): Blob {
    const headers = [
      'Title',
      'Latitude',
      'Longitude',
      'Coordinates',
      'Place_ID',
      'Feature_ID',
      'CID',
      'List_Title',
      'List_ID',
      'User_Note',
      'Address',
      'Category',
      'Phone_Number',
      'Website_URL',
      'Rating',
      'Review_Count',
      'Price_Level',
      'Operational_Status',
      'Date_Added_To_List',
      'Source_URL',
      'Precision_Type',
      'Extracted_At',
    ];

    const escapeField = (value: unknown): string => {
      if (value === null || value === undefined) return '""';
      const str = String(value);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const rows = items.map((item) => [
      escapeField(item.title),
      escapeField(item.latitude),
      escapeField(item.longitude),
      escapeField(`${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`),
      escapeField(item.placeId || item.id),
      escapeField(item.featureId || ''),
      escapeField(item.cid || ''),
      escapeField(item.listTitle || ''),
      escapeField(item.listId || ''),
      escapeField(item.userNote || ''),
      escapeField(item.address || ''),
      escapeField(item.category || ''),
      escapeField(item.phoneNumber || ''),
      escapeField(item.websiteUrl || ''),
      escapeField(item.rating ?? ''),
      escapeField(item.reviewCount ?? ''),
      escapeField(item.priceLevel || ''),
      escapeField(item.operationalStatus || 'Operational'),
      escapeField(item.dateAddedToList || ''),
      escapeField(item.url),
      escapeField(item.isHighPrecision ? 'Sub-meter Pin' : 'Viewport Camera'),
      escapeField(item.extractedAt),
    ]);

    const csvBody = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    return new Blob([csvBody], { type: 'text/csv;charset=utf-8' });
  }

  /**
   * Serializes raw RPC intercepted payloads, DOM card snapshots, spatial deduplication traces,
   * and harvested places into an indented JSON blob for forensic audit and diagnostic inspection.
   */
  public static toRawDiagnosticJson(data: RawDiagnosticDump): Blob {
    const jsonString = JSON.stringify(data, null, 2);
    return new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  }

  /**
   * Triggers an in-memory direct file download via a transient DOM anchor.
   */
  public static triggerDownload(blob: Blob, fileName: string): void {
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
  }
}
