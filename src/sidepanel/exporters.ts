/**
 * In-memory spatial data exporters for Google Maps entities.
 * Generates RFC 7946 GeoJSON, OGC KML 2.2, and RFC 4180 CSV Blobs directly in client memory.
 */

import type { ScrapedPlaceRecord } from '../types/places';

export class SpatialDataExporters {
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
          isHighPrecision: item.isHighPrecision,
          isClosed: !!item.isClosed,
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
        <Data name="User_Note"><value>${sanitize(item.userNote || '')}</value></Data>
        <Data name="Source_URL"><value>${sanitize(item.url)}</value></Data>
        <Data name="Precision"><value>${item.isHighPrecision ? 'Sub-meter' : 'Viewport'}</value></Data>
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
   * Generates an RFC 4180 compliant CSV document Blob.
   */
  public static toCSV(items: ScrapedPlaceRecord[]): Blob {
    const headers = [
      'Title',
      'Latitude',
      'Longitude',
      'Place_ID',
      'Address',
      'Category',
      'User_Note',
      'Source_URL',
      'Is_High_Precision',
      'Exported_At',
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
      escapeField(item.placeId || item.id),
      escapeField(item.address || ''),
      escapeField(item.category || ''),
      escapeField(item.userNote || ''),
      escapeField(item.url),
      escapeField(item.isHighPrecision),
      escapeField(item.extractedAt),
    ]);

    const csvBody = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    return new Blob([csvBody], { type: 'text/csv;charset=utf-8' });
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
